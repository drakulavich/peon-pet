#!/bin/bash
# Creates a macOS LaunchAgent to start peon-ping-avatar on login.

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.peonping.avatar.plist"
BUN_PATH="$(command -v bun || echo "$HOME/.bun/bin/bun")"

# Build the native shim before installing (libpeonshell.dylib is gitignored).
( cd "$APP_DIR" && "$BUN_PATH" run build:native )

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.peonping.avatar</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN_PATH</string>
    <string>run</string>
    <string>$APP_DIR/src/main.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardErrorPath</key>
  <string>$HOME/.peon-avatar.log</string>
  <key>StandardOutPath</key>
  <string>$HOME/.peon-avatar.log</string>
</dict>
</plist>
EOF

launchctl load "$PLIST_PATH"
echo "Auto-start installed. Avatar will launch on next login."
echo "To start now: launchctl start com.peonping.avatar"
echo "To remove:    launchctl unload $PLIST_PATH && rm $PLIST_PATH"
