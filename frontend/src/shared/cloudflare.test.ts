import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHandler, publicBrowserConfig} from '../../cloudflare/worker.js';

const config = {auth_mode:'supabase',supabase_url:'https://test.supabase.co',supabase_key:'sb_publishable_test',google_enabled:true};
const handler = createHandler(config);
const assets = {fetch:vi.fn(() => new Response('static page'))};
const env = {ASSETS:assets};
afterEach(() => {vi.unstubAllGlobals();vi.clearAllMocks();});

describe('Cloudflare browser API boundary', () => {
  it('loads sign-in configuration without waking Render and never emits extra server fields', async () => {
    const fetch = vi.fn();vi.stubGlobal('fetch',fetch);
    const response = await createHandler({...config,secret_key:'do-not-publish'}).fetch(new Request('https://site.test/api/config'),env);
    expect(await response.json()).toEqual({...publicBrowserConfig(config),email_enabled:false,signup_enabled:false});
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
    expect(() => publicBrowserConfig({...config,supabase_key:'eyJ.service-role'})).toThrow();
    expect(() => publicBrowserConfig({...config,supabase_url:'http://test.supabase.co'})).toThrow();
    expect(() => publicBrowserConfig({...config,supabase_url:'https://test.supabase.co@evil.test'})).toThrow();
  });

  it('forwards one mutation to the fixed API, preserving credentials and idempotency but no cookies', async () => {
    const fetch = vi.fn(async () => Response.json({id:42},{headers:{'Set-Cookie':'upstream=private','Cache-Control':'public,max-age=3600'}}));
    vi.stubGlobal('fetch',fetch);
    const response = await handler.fetch(new Request('https://site.test/api/goals?next=https://evil.test', {
      method:'POST',headers:{Authorization:'Bearer test-token','Content-Type':'application/json','Idempotency-Key':'test-id',Cookie:'local=cookie',Origin:'https://site.test'},body:'{"title":"Study"}',
    }),env);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url,options] = fetch.mock.calls[0] as unknown as [URL,RequestInit];
    expect(url.origin+url.pathname).toBe('https://flowlist-beta.onrender.com/api/goals');
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-token');
    expect(new Headers(options.headers).get('Idempotency-Key')).toBe('test-id');
    expect(new Headers(options.headers).has('Cookie')).toBe(false);
    expect(new TextDecoder().decode(options.body as Uint8Array)).toBe('{"title":"Study"}');
    expect(options.redirect).toBe('manual');
    expect(options.cache).toBe('no-store');
    expect(await response.json()).toEqual({id:42});
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });

  it('does not follow credential-bearing redirects, retry failures, or relay wake-up HTML', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{Location:'https://evil.test'}}))
      .mockResolvedValueOnce(new Response('waking up',{headers:{'Content-Type':'text/html'}}))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch',fetch);
    for (const status of [502,503,503]) {
      const response = await handler.fetch(new Request('https://site.test/api/account'),env);
      expect(response.status).toBe(status);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects cross-origin mutations and streamed oversized bodies before forwarding', async () => {
    const fetch = vi.fn();vi.stubGlobal('fetch',fetch);
    expect((await handler.fetch(new Request('https://site.test/api/goals',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),env)).status).toBe(403);
    expect((await handler.fetch(new Request('https://site.test/api/goals',{method:'POST',body:'x'.repeat(1024*1024+1)}),env)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves API errors and exports without caching and can serve static assets', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({detail:'Invitation only'},{status:403}))
      .mockResolvedValueOnce(Response.json({tasks:[]},{headers:{'Content-Disposition':'attachment; filename="flowlist-export.json"'}}));
    vi.stubGlobal('fetch',fetch);
    expect((await handler.fetch(new Request('https://site.test/api/account'),env)).status).toBe(403);
    const exported = await handler.fetch(new Request('https://site.test/api/history/export'),env);
    expect(exported.headers.get('Content-Disposition')).toContain('flowlist-export.json');
    expect(await exported.json()).toEqual({tasks:[]});
    expect(await (await handler.fetch(new Request('https://site.test/app/'),env)).text()).toBe('static page');
  });
});
