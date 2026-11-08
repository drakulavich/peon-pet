#!/usr/bin/env bash
# Install peon-pet as a macOS LaunchAgent so it runs at login and stays alive.
# Native Bun build — no Electron.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_SRC="$SCRIPT_DIR/com.peonpet.app.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.peonpet.app.plist"

# Locate bun (launchd needs an absolute path).
BUN="$(command -v bun || true)"
[ -z "$BUN" ] && [ -x "$HOME/.bun/bin/bun" ] && BUN="$HOME/.bun/bin/bun"
if [ -z "$BUN" ]; then
  echo "bun not found. Install it: https://bun.sh"
  exit 1
fi
BUN_REAL="$(readlink -f "$BUN" 2>/dev/null || realpath "$BUN")"

# Build the native AppKit shim (libpeonshell.dylib is gitignored).
echo "Building native shim..."
( cd "$SCRIPT_DIR" && "$BUN" run build:native )

echo "Installing peon-pet LaunchAgent..."
echo "  App dir: $SCRIPT_DIR"
echo "  Bun:     $BUN_REAL"

# Write the final plist with real paths substituted.
sed \
  -e "s|BUN_BIN_PLACEHOLDER|$BUN_REAL|g" \
  -e "s|APP_DIR_PLACEHOLDER|$SCRIPT_DIR|g" \
  "$PLIST_SRC" > "$PLIST_DEST"

# Unload any existing instance before loading.
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load -w "$PLIST_DEST"

echo "Done. peon-pet will now start at login and restart if it quits."
echo "Logs: /tmp/peon-pet.log  /tmp/peon-pet.err"
