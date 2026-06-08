// peonshell — thin native shim for the Bun + AppKit pet shell.
//
// Exposes a FLAT C API so Bun's FFI never has to marshal Objective-C selectors
// or pass NSRect structs by value (see design Open Issue 3). Asset resolution
// stays in TypeScript (src/app/asset-resolver.ts, tested); this shim only does
// the AppKit/WebKit object work and serves bytes for resolved paths.
//
// Build:  bun run build:native
//   clang -framework Cocoa -framework WebKit -dynamiclib -fobjc-arc \
//         -o native/libpeonshell.dylib native/peonshell.m

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// Callbacks into Bun (set via FFI from AppKitShell's JSCallbacks).
typedef void (*PeonMessageCb)(void *panel, const char *type);
typedef void (*PeonDockCb)(const char *id);
static PeonMessageCb gMessageCb = NULL;
static PeonDockCb gDockCb = NULL;
static NSMenu *gDockMenu = nil;
static const void *kPanelKey = &kPanelKey; // associated-object key: webview → panel

// ── Asset registry (populated from TS at startup) ──────────────────────────────
// Host-form character assets (peon-asset://<name>) → absolute file path, plus a
// project root for path-form requests (peon-asset://app/<path>). Resolution
// precedence lives in TS; here we just look up what TS registered.
static NSMutableDictionary<NSString *, NSString *> *gAssetMap = nil;
static NSString *gProjectRoot = nil;

static NSString *peon_mime_for_path(NSString *path) {
  NSString *ext = path.pathExtension.lowercaseString;
  if ([ext isEqualToString:@"html"]) return @"text/html";
  if ([ext isEqualToString:@"js"] || [ext isEqualToString:@"mjs"]) return @"text/javascript";
  if ([ext isEqualToString:@"css"]) return @"text/css";
  if ([ext isEqualToString:@"json"]) return @"application/json";
  if ([ext isEqualToString:@"png"]) return @"image/png";
  if ([ext isEqualToString:@"jpg"] || [ext isEqualToString:@"jpeg"]) return @"image/jpeg";
  if ([ext isEqualToString:@"webp"]) return @"image/webp";
  if ([ext isEqualToString:@"svg"]) return @"image/svg+xml";
  if ([ext isEqualToString:@"vert"] || [ext isEqualToString:@"frag"] ||
      [ext isEqualToString:@"glsl"]) return @"text/plain";
  return @"application/octet-stream";
}

static NSString *peon_resolve_url(NSURL *url) {
  // Host-form character asset: peon-asset://bg.png  (host=bg.png, path empty/"/")
  NSString *path = url.path ?: @"";
  if (path.length == 0 || [path isEqualToString:@"/"]) {
    NSString *name = url.host;
    if (name && gAssetMap[name]) return gAssetMap[name];
    return nil;
  }
  // Path-form renderer file: peon-asset://app/<path under project root>
  if (!gProjectRoot) return nil;
  NSString *rel = [path hasPrefix:@"/"] ? [path substringFromIndex:1] : path;
  NSString *full = [gProjectRoot stringByAppendingPathComponent:rel];
  // Clamp inside the project root (defense in depth; NSURL already normalizes ..).
  NSString *std = full.stringByStandardizingPath;
  if (![std hasPrefix:gProjectRoot.stringByStandardizingPath]) return nil;
  return std;
}

// ── peon-asset:// scheme handler ──────────────────────────────────────────────
@interface PeonSchemeHandler : NSObject <WKURLSchemeHandler>
@end

static bool gVerbose = false;

@implementation PeonSchemeHandler
- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
  NSURL *url = task.request.URL;
  NSString *filePath = peon_resolve_url(url);
  NSData *data = filePath ? [NSData dataWithContentsOfFile:filePath] : nil;
  if (gVerbose) {
    fprintf(stderr, "[scheme] %s -> %s (%s)\n", url.absoluteString.UTF8String,
            filePath ? filePath.UTF8String : "(unresolved)",
            data ? [NSString stringWithFormat:@"%lu bytes", (unsigned long)data.length].UTF8String
                 : "NOT FOUND");
  }
  if (!data) {
    [task didFailWithError:[NSError errorWithDomain:@"peon-asset" code:404 userInfo:nil]];
    return;
  }
  // NSHTTPURLResponse so we can send CORS + Content-Type. Character assets are
  // host-form (peon-asset://<file>) = a different origin from the document
  // (peon-asset://app); three.js TextureLoader fetches them with crossOrigin
  // 'anonymous', so without Access-Control-Allow-Origin the textures are tainted
  // and never reach WebGL (the orc draws but is invisible).
  NSDictionary *headers = @{
    @"Content-Type" : peon_mime_for_path(filePath),
    @"Content-Length" : [NSString stringWithFormat:@"%lu", (unsigned long)data.length],
    @"Access-Control-Allow-Origin" : @"*",
    @"Cache-Control" : @"no-store",
  };
  NSHTTPURLResponse *resp = [[NSHTTPURLResponse alloc] initWithURL:url
                                                       statusCode:200
                                                      HTTPVersion:@"HTTP/1.1"
                                                     headerFields:headers];
  [task didReceiveResponse:resp];
  [task didReceiveData:data];
  [task didFinish];
}
- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {}
@end

static PeonSchemeHandler *gSchemeHandler = nil; // keep alive

// ── Diagnostics delegate: navigation + page console/errors → stderr ───────────
@interface PeonDelegate : NSObject <WKNavigationDelegate, WKScriptMessageHandler, NSApplicationDelegate>
@end

@implementation PeonDelegate
- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)nav {
  if (gVerbose) fprintf(stderr, "[nav] didFinish\n");
}
- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)nav withError:(NSError *)e {
  fprintf(stderr, "[nav] didFail: %s\n", e.localizedDescription.UTF8String);
}
- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)nav
                       withError:(NSError *)e {
  fprintf(stderr, "[nav] didFailProvisional: %s\n", e.localizedDescription.UTF8String);
}
- (void)userContentController:(WKUserContentController *)ucc
      didReceiveScriptMessage:(WKScriptMessage *)message {
  if ([message.name isEqualToString:@"peon"] && gMessageCb) {
    // Renderer → native (drag-start / drag-stop). Route to the owning panel.
    NSPanel *panel = objc_getAssociatedObject(message.webView, kPanelKey);
    NSString *type = nil;
    if ([message.body isKindOfClass:[NSDictionary class]]) type = message.body[@"type"];
    if (panel && type) gMessageCb((__bridge void *)panel, type.UTF8String);
    return;
  }
  if (gVerbose) {
    fprintf(stderr, "[%s] %s\n", message.name.UTF8String,
            [NSString stringWithFormat:@"%@", message.body].UTF8String);
  }
}

// Dock menu (Hide/Show/Quit). Items carry their id in representedObject.
- (NSMenu *)applicationDockMenu:(NSApplication *)sender {
  return gDockMenu;
}
- (void)peonDockAction:(NSMenuItem *)item {
  if (gDockCb && [item.representedObject isKindOfClass:[NSString class]]) {
    gDockCb(((NSString *)item.representedObject).UTF8String);
  }
}
@end

static PeonDelegate *gDelegate = nil; // keep alive

// JS injected at document start: forward page errors + console.error to native
// (surfaces renderer problems that are otherwise invisible from the Bun side).
static NSString *const kPeonLogJS =
    @"(function(){function s(k,m){try{window.webkit.messageHandlers.peonlog.postMessage(k+': '+m);}catch(e){}}"
    @"window.addEventListener('error',function(e){s('error',(e.message||'')+' @ '+(e.filename||'')+':'+(e.lineno||''));});"
    @"window.addEventListener('unhandledrejection',function(e){s('reject',String(e.reason));});"
    @"var oe=console.error;console.error=function(){s('console.error',Array.prototype.join.call(arguments,' '));oe.apply(console,arguments);};})();";

void peon_set_verbose(bool v) { gVerbose = v; }

// JS injected at document start: define window.peonBridge (the surface the
// renderer expects from Electron's preload) over WKScriptMessageHandler. Native
// pushes events via evaluateJavaScript("window.__peonEmit(channel, data)").
static NSString *const kPeonBridgeJS =
    @"(function(){var H={};window.__peonHandlers=H;"
    @"function post(m){try{window.webkit.messageHandlers.peon.postMessage(m);}catch(e){}}"
    @"window.peonBridge={"
    @"onEvent:function(cb){H.event=cb;},"
    @"onSessionUpdate:function(cb){H.session=cb;},"
    @"onConfig:function(cb){H.config=cb;},"
    @"startDrag:function(){post({type:'drag-start'});},"
    @"stopDrag:function(){post({type:'drag-stop'});}};"
    @"window.__peonEmit=function(channel,data){"
    @"if(channel==='peon-event'&&H.event)H.event(data);"
    @"else if(channel==='session-update'&&H.session)H.session(data);"
    @"else if(channel==='peon-config'&&H.config)H.config(data);};})();";

// ── App lifecycle ─────────────────────────────────────────────────────────────
void peon_init(void) {
  setvbuf(stderr, NULL, _IONBF, 0); // unbuffered so diagnostics survive
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  if (!gAssetMap) gAssetMap = [NSMutableDictionary dictionary];
  if (!gSchemeHandler) gSchemeHandler = [[PeonSchemeHandler alloc] init];
  if (!gDelegate) gDelegate = [[PeonDelegate alloc] init];
  [NSApp setDelegate:gDelegate]; // serves the dock menu
}

void peon_set_project_root(const char *root) {
  gProjectRoot = [[NSString stringWithUTF8String:root] stringByStandardizingPath];
}

void peon_register_asset(const char *name, const char *absPath) {
  if (!gAssetMap) gAssetMap = [NSMutableDictionary dictionary];
  gAssetMap[[NSString stringWithUTF8String:name]] = [NSString stringWithUTF8String:absPath];
}

// ── Panel creation ────────────────────────────────────────────────────────────
static NSPanel *peon_new_panel(double x, double y, double w, double h) {
  NSRect frame = NSMakeRect(x, y, w, h);
  NSWindowStyleMask mask =
      NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel;
  NSPanel *panel = [[NSPanel alloc] initWithContentRect:frame
                                              styleMask:mask
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
  panel.opaque = NO;
  panel.hasShadow = NO;
  panel.backgroundColor = [NSColor clearColor];
  panel.level = NSScreenSaverWindowLevel;
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                             NSWindowCollectionBehaviorStationary |
                             NSWindowCollectionBehaviorFullScreenAuxiliary;
  [panel setIgnoresMouseEvents:YES];
  return panel;
}

// Spike: a solid translucent panel with a label (no web view). Kept for
// src/spike.ts smoke testing.
void *peon_make_panel(double x, double y, double w, double h) {
  NSPanel *panel = peon_new_panel(x, y, w, h);
  panel.backgroundColor =
      [NSColor colorWithCalibratedRed:1.0 green:0.45 blue:0.1 alpha:0.55];
  NSTextField *label = [[NSTextField alloc] initWithFrame:NSMakeRect(0, h / 2 - 14, w, 28)];
  label.stringValue = @"peon spike";
  label.alignment = NSTextAlignmentCenter;
  label.bezeled = NO;
  label.editable = NO;
  label.selectable = NO;
  label.drawsBackground = NO;
  label.textColor = [NSColor whiteColor];
  [panel.contentView addSubview:label];
  return (void *)CFBridgingRetain(panel);
}

// Real shell: a transparent panel whose content view is a WKWebView wired to the
// peon-asset:// scheme handler. Load it with peon_panel_load.
void *peon_make_webview_panel(double x, double y, double w, double h) {
  NSPanel *panel = peon_new_panel(x, y, w, h);

  if (!gSchemeHandler) gSchemeHandler = [[PeonSchemeHandler alloc] init];
  if (!gDelegate) gDelegate = [[PeonDelegate alloc] init];

  WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
  [cfg setURLSchemeHandler:gSchemeHandler forURLScheme:@"peon-asset"];

  // Inject error/console forwarding and register the log message handler.
  WKUserScript *logScript =
      [[WKUserScript alloc] initWithSource:kPeonLogJS
                             injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                          forMainFrameOnly:YES];
  [cfg.userContentController addUserScript:logScript];
  // peonBridge shim must exist before the document's module scripts run.
  WKUserScript *bridgeScript =
      [[WKUserScript alloc] initWithSource:kPeonBridgeJS
                             injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                          forMainFrameOnly:YES];
  [cfg.userContentController addUserScript:bridgeScript];
  [cfg.userContentController addScriptMessageHandler:gDelegate name:@"peonlog"];
  [cfg.userContentController addScriptMessageHandler:gDelegate name:@"peon"];

  WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, w, h)
                                      configuration:cfg];
  web.navigationDelegate = gDelegate;
  // Transparent web view over the clear panel.
  @try {
    [web setValue:@(NO) forKey:@"drawsBackground"];
    if (gVerbose) fprintf(stderr, "[web] drawsBackground=NO OK\n");
  } @catch (NSException *e) {
    fprintf(stderr, "[web] drawsBackground KVC FAILED: %s\n", e.reason.UTF8String);
  }
  if (@available(macOS 12.0, *)) web.underPageBackgroundColor = [NSColor clearColor];
  // Reinforce transparency at the layer level (some macOS versions need this).
  web.wantsLayer = YES;
  web.layer.opaque = NO;
  web.layer.backgroundColor = [NSColor clearColor].CGColor;

  panel.contentView = web;
  // Let the message handler find this panel from its web view.
  objc_setAssociatedObject(web, kPanelKey, panel, OBJC_ASSOCIATION_ASSIGN);
  return (void *)CFBridgingRetain(panel);
}

void peon_panel_load(void *panel, const char *url) {
  NSPanel *p = (__bridge NSPanel *)panel;
  WKWebView *web = (WKWebView *)p.contentView;
  NSString *s = [NSString stringWithUTF8String:url];
  NSURL *nsurl = [NSURL URLWithString:s];
  if (gVerbose) fprintf(stderr, "[load] %s (url %s)\n", s.UTF8String, nsurl ? "ok" : "NIL");
  if (!nsurl) return;
  [web loadRequest:[NSURLRequest requestWithURL:nsurl]];
}

// Run JS in the panel's web view (native → renderer).
void peon_panel_eval(void *panel, const char *js) {
  WKWebView *web = (WKWebView *)((__bridge NSPanel *)panel).contentView;
  [web evaluateJavaScript:[NSString stringWithUTF8String:js] completionHandler:nil];
}

// Destroy a panel (balances the CFBridgingRetain from creation).
void peon_panel_destroy(void *panel) {
  NSPanel *p = CFBridgingRelease(panel);
  [p orderOut:nil];
  [p close];
}

// ── Panel controls ────────────────────────────────────────────────────────────
void peon_panel_show(void *panel) {
  NSPanel *p = (__bridge NSPanel *)panel;
  [p orderFrontRegardless];
  if (gVerbose) {
    NSRect f = p.frame;
    fprintf(stderr, "[show] frame=(%.0f,%.0f %0.fx%.0f) visible=%d onActiveSpace=%d\n",
            f.origin.x, f.origin.y, f.size.width, f.size.height, p.isVisible,
            p.isOnActiveSpace);
  }
}
void peon_panel_hide(void *panel) {
  [(__bridge NSPanel *)panel orderOut:nil];
}
void peon_panel_set_ignore_mouse(void *panel, bool ignore) {
  [(__bridge NSPanel *)panel setIgnoresMouseEvents:(ignore ? YES : NO)];
}
void peon_panel_set_origin(void *panel, double x, double y) {
  [(__bridge NSPanel *)panel setFrameOrigin:NSMakePoint(x, y)];
}

// The PRIMARY display (menu-bar screen, `[NSScreen screens][0]`) — deterministic
// for a corner-anchored pet, unlike `mainScreen` (the active/key screen).
static NSScreen *peon_primary_screen(void) {
  NSArray<NSScreen *> *screens = [NSScreen screens];
  return screens.count > 0 ? screens[0] : [NSScreen mainScreen];
}

// Work area (visibleFrame, excludes menu bar + dock), AppKit bottom-left coords on
// the primary display. AppKitShell converts between these and its top-left convention.
double peon_work_left(void) { return peon_primary_screen().visibleFrame.origin.x; }
double peon_work_width(void) { return peon_primary_screen().visibleFrame.size.width; }
double peon_work_height(void) { return peon_primary_screen().visibleFrame.size.height; }
// Top edge of the work area in AppKit coords (origin.y + height).
double peon_work_top(void) {
  NSRect vf = peon_primary_screen().visibleFrame;
  return vf.origin.y + vf.size.height;
}

// Global cursor position, raw AppKit screen coords (bottom-left origin).
double peon_cursor_x(void) { return [NSEvent mouseLocation].x; }
double peon_cursor_y(void) { return [NSEvent mouseLocation].y; }

// ── Callbacks + dock ──────────────────────────────────────────────────────────
void peon_set_message_callback(void *cb) { gMessageCb = (PeonMessageCb)cb; }
void peon_set_dock_callback(void *cb) { gDockCb = (PeonDockCb)cb; }

void peon_set_dock_icon(const char *path) {
  NSImage *img = [[NSImage alloc] initWithContentsOfFile:[NSString stringWithUTF8String:path]];
  if (img) [NSApp setApplicationIconImage:img];
}

void peon_dock_menu_clear(void) { gDockMenu = [[NSMenu alloc] init]; }

void peon_dock_menu_add(const char *id, const char *label) {
  if (!gDockMenu) gDockMenu = [[NSMenu alloc] init];
  NSMenuItem *item =
      [[NSMenuItem alloc] initWithTitle:[NSString stringWithUTF8String:label]
                                 action:@selector(peonDockAction:)
                          keyEquivalent:@""];
  item.target = gDelegate;
  item.representedObject = [NSString stringWithUTF8String:id];
  [gDockMenu addItem:item];
}

void peon_dock_menu_add_separator(void) {
  if (!gDockMenu) gDockMenu = [[NSMenu alloc] init];
  [gDockMenu addItem:[NSMenuItem separatorItem]];
}

void peon_run(void) { [NSApp run]; }

// Cooperative pump: instead of blocking in [NSApp run] (which would freeze Bun's
// libuv loop and stop the JSONL watcher / cursor poll), Bun calls this on a timer
// to service the Cocoa run loop in short slices. Keeps both event loops alive.
//
// peon_pump_begin MUST run before any window is shown: it finishes app launch and
// activates so windows actually composite. Then peon_pump (on a Bun timer) drains
// events and services timers/CoreAnimation each tick.
static bool gFinishedLaunching = false;
void peon_pump_begin(void) {
  if (gFinishedLaunching) return;
  [NSApp finishLaunching];
  // Note: we deliberately do NOT activateIgnoringOtherApps — a pet must not steal
  // focus. The non-activating panel + orderFrontRegardless still composites.
  gFinishedLaunching = true;
}

void peon_pump(void) {
  if (!gFinishedLaunching) peon_pump_begin();
  @autoreleasepool {
    NSEvent *e;
    while ((e = [NSApp nextEventMatchingMask:NSEventMaskAny
                                   untilDate:nil
                                      inMode:NSDefaultRunLoopMode
                                     dequeue:YES])) {
      [NSApp sendEvent:e];
    }
    // Service timers / observers / CoreAnimation commits briefly.
    [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode
                             beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.004]];
  }
}
