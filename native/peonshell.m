// peonshell — thin native shim for the Bun + AppKit pet shell.
//
// Exposes a FLAT C API so Bun's FFI never has to marshal Objective-C selectors
// or pass NSRect structs by value (see design Open Issue 3). The real
// AppKitShell (Phase 5) grows from this; the spike (src/spike.ts) uses it to
// prove a transparent, click-through, always-on-top panel appears bottom-left.
//
// Build:  bun run build:native
//   clang -framework Cocoa -framework WebKit -dynamiclib -fobjc-arc \
//         -o native/libpeonshell.dylib native/peonshell.m

#import <Cocoa/Cocoa.h>

// Initialize the shared application as a regular (Dock-present) app that does
// not steal focus from the user's foreground window.
void peon_init(void) {
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
}

// Create a borderless, non-activating, transparent, always-on-top,
// click-through panel at (x,y) sized (w,h). Coordinates are AppKit's
// bottom-left origin: x=margin, y=margin places it in the bottom-left corner.
// A translucent fill + label make it visible for the spike. Returns the panel.
void *peon_make_panel(double x, double y, double w, double h) {
  NSRect frame = NSMakeRect(x, y, w, h);
  NSWindowStyleMask mask =
      NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel;

  NSPanel *panel = [[NSPanel alloc] initWithContentRect:frame
                                              styleMask:mask
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];

  panel.opaque = NO;
  panel.hasShadow = NO;
  panel.backgroundColor =
      [NSColor colorWithCalibratedRed:1.0 green:0.45 blue:0.1 alpha:0.55];
  panel.level = NSScreenSaverWindowLevel; // above normal + full-screen windows
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                             NSWindowCollectionBehaviorStationary |
                             NSWindowCollectionBehaviorFullScreenAuxiliary;
  [panel setIgnoresMouseEvents:YES]; // click-through

  // Visible label so the spike is obviously on screen.
  NSTextField *label = [[NSTextField alloc] initWithFrame:NSMakeRect(0, h / 2 - 14, w, 28)];
  label.stringValue = @"peon spike\n(click through me)";
  label.alignment = NSTextAlignmentCenter;
  label.bezeled = NO;
  label.editable = NO;
  label.selectable = NO;
  label.drawsBackground = NO;
  label.textColor = [NSColor whiteColor];
  [panel.contentView addSubview:label];

  return (void *)CFBridgingRetain(panel);
}

// Show the panel without activating the app (keeps user focus where it was).
void peon_panel_show(void *panel) {
  [(__bridge NSPanel *)panel orderFrontRegardless];
}

// Toggle click-through at runtime (used later for hover capture).
void peon_panel_set_ignore_mouse(void *panel, bool ignore) {
  [(__bridge NSPanel *)panel setIgnoresMouseEvents:(ignore ? YES : NO)];
}

// Move the panel (bottom-left-origin coordinates).
void peon_panel_set_origin(void *panel, double x, double y) {
  [(__bridge NSPanel *)panel setFrameOrigin:NSMakePoint(x, y)];
}

// Primary display usable height — lets the JS side convert to bottom-left y.
double peon_primary_work_height(void) {
  NSScreen *screen = [NSScreen mainScreen];
  return screen ? screen.visibleFrame.size.height : 0.0;
}

// Enter the AppKit run loop. Blocks; the GUI lives here.
void peon_run(void) {
  [NSApp run];
}
