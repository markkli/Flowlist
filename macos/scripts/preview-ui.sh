#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
FLOWLIST_PREVIEW="$PWD/build/FlowlistPreview.app"
mkdir -p "$FLOWLIST_PREVIEW/Contents/MacOS" "$FLOWLIST_PREVIEW/Contents/Resources"
FLOWLIST_VIEW_SOURCES=()
for source in Sources/FlowlistMac/*.swift; do
  [[ "$source" == */FlowlistApp.swift ]] || FLOWLIST_VIEW_SOURCES+=("$source")
done
swiftc -parse-as-library Sources/FlowlistCore/*.swift "${FLOWLIST_VIEW_SOURCES[@]}" \
  scripts/render-previews.swift -o "$FLOWLIST_PREVIEW/Contents/MacOS/FlowlistPreview"
cp Sources/FlowlistMac/Resources/*.jpg "$FLOWLIST_PREVIEW/Contents/Resources/"
python3 - "$FLOWLIST_PREVIEW" <<'PY'
import plistlib, pathlib, sys
with open(pathlib.Path(sys.argv[1]) / "Contents/Info.plist", "wb") as output:
    plistlib.dump(dict(CFBundleExecutable="FlowlistPreview", CFBundleIdentifier="dev.flowlist.preview", CFBundleName="Flowlist Preview", CFBundlePackageType="APPL", LSUIElement=True), output)
PY
codesign --force --sign - "$FLOWLIST_PREVIEW"
"$FLOWLIST_PREVIEW/Contents/MacOS/FlowlistPreview" "$PWD/build/previews"
