"""Promote a local release manifest only after its public ZIP matches the checksum.

Usage: python3 scripts/promote-mac-release.py macos/build/releases/mac.json
"""
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlparse
from urllib.request import urlopen


def main():
    manifest = json.loads(Path(sys.argv[1]).read_text())
    url = urlparse(manifest['url'])
    version = manifest['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise SystemExit('Invalid release version')
    prefix = f'/markkli/Flowlist/releases/download/mac-v{version}/Flowlist-{version}-'
    if (url.scheme != 'https' or url.netloc != 'github.com' or not url.path.startswith(prefix)
            or not url.path.endswith('.zip') or url.query or url.fragment):
        raise SystemExit('Expected a versioned Flowlist GitHub release URL')
    if not re.fullmatch('[a-f0-9]{64}', manifest['sha256']) or not 0 < manifest['bytes'] < 500_000_000:
        raise SystemExit('Invalid archive metadata')
    digest, total = hashlib.sha256(), 0
    with urlopen(manifest['url'], timeout=60) as response:
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > manifest['bytes']:
                raise SystemExit('Published archive is larger than expected')
            digest.update(chunk)
    if total != manifest['bytes'] or digest.hexdigest() != manifest['sha256']:
        raise SystemExit('Published archive does not match the reviewed package')
    manifest['available'] = True
    destination = Path(__file__).resolve().parents[1] / 'frontend/public/releases/mac.json'
    destination.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Verified public archive; updated {destination}')


if __name__ == '__main__':
    main()
