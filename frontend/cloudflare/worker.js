// Only /api/* invokes this Pages Function. HTML, scripts, artwork and downloads
// are served directly by Pages, including when the existing API is asleep.
const API_ORIGIN = 'https://flowlist-beta.onrender.com';
const MAX_BODY_BYTES = 1024 * 1024;
const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

export function publicBrowserConfig(raw) {
  const project = new URL(raw.supabase_url);
  if (raw.auth_mode !== 'supabase' || project.protocol !== 'https:' ||
      !project.hostname.endsWith('.supabase.co') || project.origin !== raw.supabase_url ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(raw.supabase_key)) {
    throw new Error('Cloudflare requires a Supabase origin and public publishable key.');
  }
  // Never serialize arbitrary server configuration or secret/service-role keys.
  return {
    auth_mode: 'supabase', supabase_url: project.origin, supabase_key: raw.supabase_key,
    google_enabled: raw.google_enabled === true, email_enabled: raw.email_enabled === true,
    signup_enabled: raw.signup_enabled === true, browser_host: 'cloudflare',
    google_redirect_path: '/app/',
  };
}

function errorResponse(detail, status) {
  return Response.json({detail}, {status, headers: PRIVATE_HEADERS});
}

export function createHandler(rawConfig) {
  const config = publicBrowserConfig(rawConfig);
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) {
        return errorResponse('Method not allowed.', 405);
      }
      if (url.pathname === '/api/config') {
        if (!['GET', 'HEAD'].includes(request.method)) return errorResponse('Method not allowed.', 405);
        return new Response(request.method === 'HEAD' ? null : JSON.stringify(config), {
          headers: {...PRIVATE_HEADERS, 'Content-Type': 'application/json'},
        });
      }
      const origin = request.headers.get('Origin');
      if (origin && origin !== url.origin) return errorResponse('Cross-origin API requests are not allowed.', 403);
      const headers = new Headers();
      for (const name of ['Authorization', 'Content-Type', 'Accept', 'Idempotency-Key']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      let body;
      if (!['GET', 'HEAD'].includes(request.method)) {
        if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) {
          return errorResponse('Request too large.', 413);
        }
        // Bound streamed requests too; Content-Length is not a trusted limit.
        const reader = request.body?.getReader();
        const chunks = [];
        let size = 0;
        if (reader) while (true) {
          const {value, done} = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            return errorResponse('Request too large.', 413);
          }
          chunks.push(value);
        }
        body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      }
      // Construct from a fixed origin: query parameters can never select a host.
      const upstream = new URL(API_ORIGIN);
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      let response;
      try {
        response = await fetch(upstream, {
          method: request.method, headers, body, redirect: 'manual', cache: 'no-store',
          signal: AbortSignal.timeout(75000),
        });
      } catch {
        return errorResponse('Your workspace is taking longer to connect. Please try again.', 503);
      }
      // Do not follow redirects with bearer credentials or relay an HTML wake-up
      // page as JSON. Mutations are forwarded once, never automatically retried.
      if (response.status >= 300 && response.status < 400) {
        return errorResponse('The workspace service returned an unexpected redirect.', 502);
      }
      if (response.status !== 204 && request.method !== 'HEAD' &&
          !response.headers.get('Content-Type')?.includes('application/json')) {
        return errorResponse('Your workspace is taking longer to connect. Please try again.', 503);
      }
      const responseHeaders = new Headers(PRIVATE_HEADERS);
      for (const name of ['Content-Type', 'Content-Disposition', 'Retry-After']) {
        const value = response.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      return new Response(response.body, {status: response.status, headers: responseHeaders});
    },
  };
}
