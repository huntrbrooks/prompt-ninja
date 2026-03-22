#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# Ad-hoc code sign PromptPlus with entitlements
# This gives the app a stable identity so macOS TCC permissions persist
# ═══════════════════════════════════════════════════════════════

# Find the app in whatever output directory electron-builder used
if [ -d "dist/mac-universal/PromptPlus.app" ]; then
  APP_PATH="dist/mac-universal/PromptPlus.app"
elif [ -d "dist/mac-arm64/PromptPlus.app" ]; then
  APP_PATH="dist/mac-arm64/PromptPlus.app"
elif [ -d "dist/mac/PromptPlus.app" ]; then
  APP_PATH="dist/mac/PromptPlus.app"
else
  APP_PATH=""
fi
ENTITLEMENTS="build/entitlements.mac.plist"

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  echo "ERROR: PromptPlus.app not found in dist/. Run 'npm run build' first."
  exit 1
fi

echo "Signing PromptPlus.app (ad-hoc with entitlements)..."

# Sign all nested frameworks and helpers first (deep signing)
# Ad-hoc signing (no Apple Developer cert) — do NOT use --options runtime
# which requires a real certificate and causes launch crashes
codesign --sign - \
  --force \
  --deep \
  --entitlements "$ENTITLEMENTS" \
  --identifier "com.promptplus.app" \
  "$APP_PATH"

if [ $? -eq 0 ]; then
  echo "✓ Signed successfully"
  echo ""
  echo "Verifying..."
  codesign -dvv "$APP_PATH" 2>&1 | grep -E "Identifier=|Signature=|Info.plist|CDHash"
  echo ""
  echo "Entitlements:"
  codesign -d --entitlements :- "$APP_PATH" 2>&1 | head -20
  echo ""
  echo "✓ Ready to launch: open $APP_PATH"
else
  echo "ERROR: Signing failed"
  exit 1
fi
