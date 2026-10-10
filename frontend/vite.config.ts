import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { publicBrowserConfig } from './cloudflare/worker.js';

export default defineConfig(({mode}) => ({
  plugins: mode === 'site' ? [{
    name: 'static-site-routing',
    generateBundle() {
      const config = publicBrowserConfig(JSON.parse(readFileSync(resolve(import.meta.dirname, 'cloudflare/browser-config.json'), 'utf8')));
      const worker = readFileSync(resolve(import.meta.dirname, 'cloudflare/worker.js'), 'utf8');
      this.emitFile({type:'asset',fileName:'_worker.js',source: `${worker}\nexport default createHandler(${JSON.stringify(config)});\n`});
      this.emitFile({type:'asset',fileName:'_routes.json',source:
        JSON.stringify({version:1,include:['/api/*'],exclude:[]})});
      const publicCSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
      const appCSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${config.supabase_url}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`;
      this.emitFile({type:'asset',fileName:'_headers',source:
        `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n/\n  Content-Security-Policy: ${publicCSP}\n/download/*\n  Content-Security-Policy: ${publicCSP}\n/app/*\n  Cache-Control: no-store\n  Content-Security-Policy: ${appCSP}\n/releases/*\n  Cache-Control: no-store\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`});
      this.emitFile({type:'asset',fileName:'404.html',source:
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · Flowlist</title><h1>Page not found</h1><p><a href="/">Return to Flowlist</a></p></html>'});
    },
  }] : [],
  build: { rollupOptions: { input: mode === 'native'
    ? { app: resolve(import.meta.dirname, 'app/index.html') }
    : { site: resolve(import.meta.dirname, 'index.html'), download: resolve(import.meta.dirname, 'download/index.html'), app: resolve(import.meta.dirname, 'app/index.html') } } },
  server: { proxy: { '/api': { target: process.env.FLOWLIST_API_TARGET || 'http://127.0.0.1:8000', rewrite: path => path.replace(/^\/api/, '') } } },
}));
