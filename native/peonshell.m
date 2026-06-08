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

@implementation PeonSchemeHandler
- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
  NSURL *url = task.request.URL;
  NSString *filePath = peon_resolve_url(url);
  NSData *data = filePath ? [NSData dataWithContentsOfFile:filePath] : nil;
  if (!data) {
    [task didFailWithError:[NSError errorWithDomain:@"peon-asset" code:404 userInfo:nil]];
    return;
  }
  NSURLResponse *resp = [[NSURLResponse alloc] initWithURL:url
                                                  MIMEType:peon_mime_for_path(filePath)
                                     expectedContentLength:data.length
                                          textEncodingName:nil];
  [task didReceiveResponse:resp];
  [task didReceiveData:data];
  [task didFinish];
}
- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {}
@end

static PeonSchemeHandler *gSchemeHandler = nil; // keep alive

// ── App lifecycle ─────────────────────────────────────────────────────────────
void peon_init(void) {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
  if (!gAssetMap) gAssetMap = [NSMutableDictionary dictionary];
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
  WKWebViewConfiguration *cfg = [[WKWebViewConfiguration alloc] init];
  [cfg setURLSchemeHandler:gSchemeHandler forURLScheme:@"peon-asset"];

  WKWebView *web = [[WKWebView alloc] initWithFrame:NSMakeRect(0, 0, w, h)
                                      configuration:cfg];
  // Transparent web view over the clear panel.
  @try { [web setValue:@(NO) forKey:@"drawsBackground"]; } @catch (__unused id e) {}
  if (@available(macOS 12.0, *)) web.underPageBackgroundColor = [NSColor clearColor];

  panel.contentView = web;
  return (void *)CFBridgingRetain(panel);
}

void peon_panel_load(void *panel, const char *url) {
  NSPanel *p = (__bridge NSPanel *)panel;
  WKWebView *web = (WKWebView *)p.contentView;
  NSURL *nsurl = [NSURL URLWithString:[NSString stringWithUTF8String:url]];
  [web loadRequest:[NSURLRequest requestWithURL:nsurl]];
}

// ── Panel controls ────────────────────────────────────────────────────────────
void peon_panel_show(void *panel) {
  [(__bridge NSPanel *)panel orderFrontRegardless];
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

double peon_primary_work_height(void) {
  NSScreen *screen = [NSScreen mainScreen];
  return screen ? screen.visibleFrame.size.height : 0.0;
}

void peon_run(void) { [NSApp run]; }
