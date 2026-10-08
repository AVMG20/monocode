#!/usr/bin/env bash
set -euo pipefail

# Builds the app bundle and installs it as the only MonoCode LaunchServices
# knows about. Notification clicks are routed by bundle identifier, not by the
# running process: with a second copy registered under the same identifier
# (an upstream install in /Applications, a bundle under some target/ dir),
# macOS may launch that copy instead of focusing the running one, leaving two
# MonoCodes in the Dock.

if [ "$(uname)" != "Darwin" ]; then
  echo "This helper only supports macOS." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="/Applications/MonoCode.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

cd "$ROOT"
if [ "${1:-}" != "--skip-build" ]; then
  # Local builds have no updater signing key; skip the updater archive.
  npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'
fi

BUILT="$ROOT/target/release/bundle/macos/MonoCode.app"
if [ ! -d "$BUILT" ]; then
  echo "No bundle at $BUILT" >&2
  exit 1
fi
IDENTIFIER="$(defaults read "$BUILT/Contents/Info" CFBundleIdentifier)"

# A previous install goes to the Trash rather than away, so an upstream copy
# can still be recovered.
if [ -d "$DEST" ]; then
  TRASHED="$HOME/.Trash/MonoCode $(date +%Y%m%d-%H%M%S).app"
  mv "$DEST" "$TRASHED"
  "$LSREGISTER" -u "$TRASHED" >/dev/null 2>&1 || true
  echo "Moved the previous install to $TRASHED"
fi
ditto "$BUILT" "$DEST"

# Forget every other bundle registered under this identifier, including the
# build output that was just copied.
"$LSREGISTER" -dump 2>/dev/null \
  | awk -v id="$IDENTIFIER" '
      /^path:/ { sub(/^path:[ \t]*/, ""); sub(/ \(0x[0-9a-f]+\)$/, ""); path = $0 }
      /^identifier:/ { if ($2 == id) print path }
    ' \
  | sort -u \
  | while IFS= read -r path; do
      if [ "$path" != "$DEST" ]; then
        "$LSREGISTER" -u "$path" >/dev/null 2>&1 || true
        echo "Unregistered $path"
      fi
    done
"$LSREGISTER" -f "$DEST"

echo "Installed $DEST. Quit any MonoCode running from elsewhere and open this one."
