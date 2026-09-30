import './site.css';

// Preserve old workspace bookmarks and the currently allowlisted OAuth return.
// Keep the query/fragment only on our own origin, never in an external request.
const legacy = new URL(location.href);
const workspaceHashes = ['#dashboard', '#goals', '#history'];
const hasAuth = legacy.searchParams.has('auth') || legacy.searchParams.has('code') || /(?:access_token|error_description|error_code)=/.test(legacy.hash);
if (import.meta.env.MODE === 'site' && hasAuth) {
  // OAuth remains on the workspace origin. Never relay credentials through a
  // static-host redirect to another origin.
  history.replaceState(null, '', legacy.pathname);
} else if (legacy.pathname === '/' && (workspaceHashes.includes(legacy.hash) || hasAuth)) {
  location.replace(`/app/${legacy.search}${legacy.hash}`);
}

interface Release {
  available: boolean;
  version: string;
  minimumMacOS: string;
  architecture: string;
  url: string | null;
  sha256: string | null;
  bytes: number | null;
  widgetIncluded: boolean;
}

async function showRelease() {
  const status = document.getElementById('release-status');
  if (!status) return;
  const button = document.getElementById('mac-download') as HTMLAnchorElement;
  const meta = document.getElementById('release-meta')!;
  try {
    const response = await fetch('/releases/mac.json', {cache: 'no-store', signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('Release unavailable');
    const release = await response.json() as Release;
    if (!release.available) {
      status.textContent = 'The Mac download is being prepared. You can use the browser beta now.';
      return;
    }
    const url = new URL(release.url || '', location.origin);
    const trusted = url.origin === location.origin && url.pathname.startsWith('/downloads/') ||
      url.origin === 'https://github.com' && url.pathname.startsWith('/markkli/Flowlist/releases/download/');
    if (!trusted || !/^[a-f0-9]{64}$/.test(release.sha256 || '') || !release.bytes || release.bytes <= 0) throw new Error('Invalid release');
    button.href = url.href;
    button.hidden = false;
    status.textContent = 'Ready to download';
    meta.textContent = `Version ${release.version} · macOS ${release.minimumMacOS}+ · ${release.architecture} · ${(release.bytes / 1_000_000).toFixed(1)} MB`;
    const checksum = document.createElement('details');
    checksum.className = 'download-checksum';
    const summary = document.createElement('summary'); summary.textContent = 'Verify download';
    const hash = document.createElement('code'); hash.textContent = `SHA-256: ${release.sha256}`;
    checksum.append(summary, hash); meta.after(checksum);
    if (release.widgetIncluded) document.getElementById('widget-release-note')!.textContent = 'Includes the desktop widget.';
  } catch {
    status.textContent = 'The download could not be checked. Please reload, or use the browser beta.';
  }
}
void showRelease();
