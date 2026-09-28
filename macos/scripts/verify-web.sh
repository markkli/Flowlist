#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/build-web.sh
FLOWLIST_SMOKE_APP="$PWD/build/FlowlistWebSmoke.app"
mkdir -p "$FLOWLIST_SMOKE_APP/Contents/MacOS" "$FLOWLIST_SMOKE_APP/Contents/Resources"
FLOWLIST_SMOKE_SOURCES="$(mktemp -d "$PWD/build/web-smoke-sources.XXXXXX")"
trap 'rm -rf "$FLOWLIST_SMOKE_SOURCES"' EXIT
mkdir -p "$FLOWLIST_SMOKE_SOURCES/Core" "$FLOWLIST_SMOKE_SOURCES/Mac"
cp Sources/FlowlistCore/*.swift "$FLOWLIST_SMOKE_SOURCES/Core/"
cp Sources/FlowlistMac/*.swift "$FLOWLIST_SMOKE_SOURCES/Mac/"
cp scripts/verify-web.swift "$FLOWLIST_SMOKE_SOURCES/verify-web.swift"
FLOWLIST_VIEW_SOURCES=()
for source in "$FLOWLIST_SMOKE_SOURCES/Mac/"*.swift; do
  [[ "$source" == */FlowlistApp.swift ]] || FLOWLIST_VIEW_SOURCES+=("$source")
done
swiftc -parse-as-library "$FLOWLIST_SMOKE_SOURCES/Core/"*.swift "${FLOWLIST_VIEW_SOURCES[@]}" \
  "$FLOWLIST_SMOKE_SOURCES/verify-web.swift" -o "$FLOWLIST_SMOKE_APP/Contents/MacOS/FlowlistWebSmoke"
rm -rf "$FLOWLIST_SMOKE_APP/Contents/Resources/WebUI"
cp -R Sources/FlowlistMac/Resources/WebUI "$FLOWLIST_SMOKE_APP/Contents/Resources/WebUI"
python3 - "$FLOWLIST_SMOKE_APP" <<'PY'
import plistlib, pathlib, sys
with open(pathlib.Path(sys.argv[1]) / "Contents/Info.plist", "wb") as output:
    plistlib.dump(dict(CFBundleExecutable="FlowlistWebSmoke", CFBundleIdentifier="dev.flowlist.web-smoke", CFBundleName="Flowlist Web Smoke", CFBundlePackageType="APPL", LSUIElement=True), output)
PY
codesign --force --sign - "$FLOWLIST_SMOKE_APP"
"$FLOWLIST_SMOKE_APP/Contents/MacOS/FlowlistWebSmoke" "$PWD/build/previews"
