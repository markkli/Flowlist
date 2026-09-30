#!/bin/bash
set -euo pipefail

FLOWLIST_MAC_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FLOWLIST_REPO_ROOT="$(dirname "$FLOWLIST_MAC_ROOT")"
# Xcode launched from Finder doesn't inherit the terminal's Homebrew PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v npm >/dev/null 2>&1; then
  echo "Flowlist needs Node.js and npm to build its bundled dashboard." >&2
  exit 1
fi
if [[ ! -d "$FLOWLIST_REPO_ROOT/frontend/node_modules" ]]; then
  echo "Install the frontend dependencies first: cd frontend && npm ci" >&2
  exit 1
fi

cd "$FLOWLIST_REPO_ROOT/frontend"
npm run build -- --mode native
test -s dist/app/index.html

# Keep the last working bundle if the web build fails. Replace the whole tree
# after a successful build, so outdated hashed assets cannot survive packaging.
FLOWLIST_RESOURCES="$FLOWLIST_MAC_ROOT/Sources/FlowlistMac/Resources"
FLOWLIST_WEB_STAGE="$(mktemp -d "$FLOWLIST_MAC_ROOT/build-web.XXXXXX")"
trap 'rm -rf "$FLOWLIST_WEB_STAGE"' EXIT
cp -R dist/. "$FLOWLIST_WEB_STAGE/"
mv "$FLOWLIST_WEB_STAGE/app/index.html" "$FLOWLIST_WEB_STAGE/index.html"
rmdir "$FLOWLIST_WEB_STAGE/app"
# Release metadata belongs to the website, never to the offline app bundle.
rm -rf "$FLOWLIST_WEB_STAGE/releases" "$FLOWLIST_WEB_STAGE/downloads"
mkdir -p "$FLOWLIST_RESOURCES"
rm -rf "$FLOWLIST_RESOURCES/WebUI"
mv "$FLOWLIST_WEB_STAGE" "$FLOWLIST_RESOURCES/WebUI"
echo "Bundled dashboard: $FLOWLIST_RESOURCES/WebUI"
