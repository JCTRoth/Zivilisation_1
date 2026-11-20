#!/usr/bin/env node
/**
 * A minimal static file server for the production build.
 *
 * The offline e2e spec needs the *built* app (a service worker only exists
 * in a production build) served over http://localhost, which browsers treat
 * as a secure context. Pulling in a dependency for that would be silly, so
 * this script does the job: correct MIME types, an SPA fallback and the
 * cache headers the container's nginx config sets.
 *
 *   node scripts/static-server.mjs [--root dist] [--port 4173]
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const ROOT = resolve(readArg('root', 'dist'));
const PORT = Number(readArg('port', '4173'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** The same cache policy as packages/web/nginx.conf. */
function cacheControl(pathname) {
  if (pathname === '/sw.js') return 'no-cache, no-store, must-revalidate';
  if (pathname === '/index.html') return 'no-cache';
  if (pathname === '/manifest.webmanifest') return 'public, max-age=3600';
  if (/\/assets\/.+-[A-Za-z0-9_-]{8}\.(js|css|woff2?|ttf|otf|eot|map)$/.test(pathname)) {
    return 'public, immutable';
  }
  if (pathname.startsWith('/assets/')) return 'public, max-age=3600';
  return 'no-cache';
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  // The container renders this file at start-up; outside a container the
  // static build has none, so serve an empty configuration instead of a 404.
  if (pathname === '/config.js' && !existsSync(join(ROOT, 'config.js'))) {
    res.setHeader('Content-Type', MIME['.js']);
    res.setHeader('Cache-Control', 'no-cache');
    res.statusCode = 200;
    res.end('window.__CIV1_CONFIG__ = { gameServer: "" };\n');
    return;
  }

  // Never escape the served root.
  const target = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  let file = target;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    file = join(ROOT, 'index.html');
  }
  if (!existsSync(file)) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }

  res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', cacheControl(pathname));
  if (pathname === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
  res.statusCode = 200;
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`[static-server] serving ${ROOT} on http://localhost:${PORT}`);
});
