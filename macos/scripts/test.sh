#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
FLOWLIST_DEVELOPER_DIR="$(xcode-select -p)"
if [[ "$FLOWLIST_DEVELOPER_DIR" == */CommandLineTools ]]; then
  # SwiftPM doesn't discover the CLT's Testing.framework automatically.
  FLOWLIST_TEST_FRAMEWORKS="$FLOWLIST_DEVELOPER_DIR/Library/Developer/Frameworks"
  swift test --disable-xctest \
    -Xswiftc -F -Xswiftc "$FLOWLIST_TEST_FRAMEWORKS" \
    -Xlinker -F -Xlinker "$FLOWLIST_TEST_FRAMEWORKS" \
    -Xlinker -rpath -Xlinker "$FLOWLIST_TEST_FRAMEWORKS" \
    -Xlinker -rpath -Xlinker "$FLOWLIST_DEVELOPER_DIR/Library/Developer/usr/lib"
else
  swift test --disable-xctest
fi
