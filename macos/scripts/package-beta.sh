#!/bin/bash
# Package the local, ad-hoc signed Mac beta. Publishing is a separate step.
set -euo pipefail
cd "$(dirname "$0")/.."
bash scripts/build-local.sh
FLOWLIST_APP="$PWD/build/Flowlist.app"
codesign --verify --deep --strict "$FLOWLIST_APP"
python3 - "$FLOWLIST_APP" "$PWD/build/releases" <<'PY'
import hashlib
import json
import pathlib
import plistlib
import subprocess
import sys

app, destination = map(pathlib.Path, sys.argv[1:])
with (app / 'Contents/Info.plist').open('rb') as source:
    info = plistlib.load(source)
version = info['CFBundleShortVersionString']
arch = subprocess.check_output(['lipo', '-archs', str(app / 'Contents/MacOS/Flowlist')], text=True).strip()
if arch not in ('arm64', 'x86_64'):
    raise SystemExit(f'Unexpected architecture: {arch}')
if (app / 'Contents/PlugIns').exists() or info.get('FlowlistAppGroup'):
    raise SystemExit('The unsigned beta must not claim a signed widget capability')
destination.mkdir(parents=True, exist_ok=True)
archive = destination / f'Flowlist-{version}-{arch}.zip'
subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(archive)], check=True)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(destination / (archive.name + '.sha256')).write_text(f'{digest}  {archive.name}\n')
manifest = dict(available=True, version=version, minimumMacOS=info['LSMinimumSystemVersion'],
               architecture='Apple silicon' if arch == 'arm64' else 'Intel',
               url=f'https://github.com/markkli/Flowlist/releases/download/mac-v{version}/{archive.name}',
               sha256=digest, bytes=archive.stat().st_size, widgetIncluded=False)
# Only promote this manifest to the public site after uploading and verifying
# the exact archive. A local package alone does not make a download available.
(destination / 'mac.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Package: {archive}\nSHA-256: {digest}')
PY
