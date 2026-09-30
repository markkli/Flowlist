import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({mode}) => ({
  plugins: mode === 'site' ? [{
    name: 'static-site-routing',
    generateBundle() {
      // The public site is static; the optional browser workspace retains its
      // existing origin, login callback, and same-origin API on Render.
      this.emitFile({type:'asset',fileName:'_redirects',source:
        '/app https://flowlist-beta.onrender.com/app/ 302\n/app/* https://flowlist-beta.onrender.com/app/:splat 302\n'});
      this.emitFile({type:'asset',fileName:'_headers',source:
        "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\n/releases/*\n  Cache-Control: no-store\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n"});
      this.emitFile({type:'asset',fileName:'404.html',source:
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · Flowlist</title><h1>Page not found</h1><p><a href="/">Return to Flowlist</a></p></html>'});
    },
  }] : [],
  build: { rollupOptions: { input: mode === 'native'
    ? { app: resolve(import.meta.dirname, 'app/index.html') }
    : mode === 'site'
    ? { site: resolve(import.meta.dirname, 'index.html'), download: resolve(import.meta.dirname, 'download/index.html') }
    : { site: resolve(import.meta.dirname, 'index.html'), download: resolve(import.meta.dirname, 'download/index.html'), app: resolve(import.meta.dirname, 'app/index.html') } } },
  server: { proxy: { '/api': { target: process.env.FLOWLIST_API_TARGET || 'http://127.0.0.1:8000', rewrite: path => path.replace(/^\/api/, '') } } },
}));
