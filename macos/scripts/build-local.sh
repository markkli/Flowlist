#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/build-web.sh
swift build -c release
FLOWLIST_BIN_DIR="$(swift build -c release --show-bin-path)"
mkdir -p "$PWD/build"
FLOWLIST_PACKAGE="$(mktemp -d "$PWD/build/package.XXXXXX")"
FLOWLIST_APP="$FLOWLIST_PACKAGE/Flowlist.app"
FLOWLIST_DESTINATION="$PWD/build/Flowlist.app"
mkdir -p "$FLOWLIST_APP/Contents/MacOS" "$FLOWLIST_APP/Contents/Resources"
cp "$FLOWLIST_BIN_DIR/Flowlist" "$FLOWLIST_APP/Contents/MacOS/Flowlist"
# Bundle native resources in the standard location; the app prefers Bundle.main.
cp -R Sources/FlowlistMac/Resources/. "$FLOWLIST_APP/Contents/Resources/"
python3 - "$FLOWLIST_APP" <<'PY'
import plistlib, pathlib, sys, shutil
old_resource_bundle = pathlib.Path(sys.argv[1]) / "Contents/MacOS/Flowlist_FlowlistMac.bundle"
if old_resource_bundle.exists():
    shutil.rmtree(old_resource_bundle)
with open("Configuration/App-Info.plist", "rb") as source:
    info = plistlib.load(source)
info["CFBundleExecutable"] = "Flowlist"
info["CFBundleIdentifier"] = "dev.flowlist.mac"
info.pop("FlowlistAppGroup", None)  # Local ad-hoc build has no signed widget extension.
with open(pathlib.Path(sys.argv[1]) / "Contents/Info.plist", "wb") as output:
    plistlib.dump(info, output)
PY
codesign --force --deep --sign - "$FLOWLIST_APP"
# Preserve the inode of a running earlier build until that process exits.
if [[ -d "$FLOWLIST_DESTINATION" ]]; then
  mv "$FLOWLIST_DESTINATION" "$FLOWLIST_PACKAGE/previous.app"
fi
mv "$FLOWLIST_APP" "$FLOWLIST_DESTINATION"
FLOWLIST_APP="$FLOWLIST_DESTINATION"
echo "Built $FLOWLIST_APP"
echo "Open with: open '$FLOWLIST_APP'"
