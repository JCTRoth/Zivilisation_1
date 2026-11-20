/* eslint-disable no-undef */
/**
 * CIV1 BROWSER — SERVICE WORKER
 *
 * Generated at build time by `packages/web/pwa/vite-plugin-pwa.mjs`. The
 * placeholders below are replaced with the real precache manifest and a
 * content-derived version stamp; the file is never edited by hand.
 *
 * Caching rules
 * -------------
 *  - Navigations            → network-first, falling back to the cached shell.
 *  - Hashed build assets    → cache-first (their filename hash makes them
 *                             immutable).
 *  - Game assets (tiles,
 *    music, SFX, wonders)   → stale-while-revalidate into a capped runtime
 *                             cache. 38 MB of artwork is cached on demand
 *                             rather than precached.
 *  - /config.js             → network-first, because the container rewrites
 *                             it at start-up and a frozen copy would point
 *                             the app at the wrong server.
 *  - Everything else        → not intercepted.
 *
 * The worker never answers a cross-origin request and never answers a
 * non-GET request, so the multiplayer transport (a different origin) and the
 * dev-only log endpoint keep working untouched.
 */

const PRECACHE_MANIFEST = __PRECACHE_MANIFEST__;
const BUILD_VERSION = __BUILD_VERSION__;

const SHELL_CACHE = `civ1-shell-${BUILD_VERSION}`;
const RUNTIME_CACHE = `civ1-runtime-${BUILD_VERSION}`;
const OWNED_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

/** The offline fallback document. */
const OFFLINE_SHELL = '/index.html';

/** How many runtime entries the game-asset cache keeps. */
const MAX_RUNTIME_ENTRIES = 600;

/** Paths that must never be cached. */
const NEVER_CACHE = [/^\/__game_log/, /^\/rooms\//];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `addAll` fails the whole install when a single request fails, so the
      // entries are fetched one by one: a missing optional file must not
      // prevent the app from working offline.
      const results = await Promise.allSettled(
        PRECACHE_MANIFEST.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })),
        ),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        console.warn(`[sw] ${failed} of ${PRECACHE_MANIFEST.length} shell files could not be precached`);
      }
      // No `skipWaiting()` here: the page decides when to swap the worker, so
      // a running game is never replaced mid-turn.
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('civ1-') && !OWNED_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // The game server is a different origin; never intercept it.
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((pattern) => pattern.test(url.pathname))) return;

  // The runtime config is rewritten by the container on every start.
  if (url.pathname === '/config.js') {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
    return;
  }
});

/** Network-first with a cached fallback. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

/**
 * Serve the app shell.
 *
 * The network is preferred so a deploy is picked up on the next online load;
 * the cached shell is the offline fallback.
 */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(OFFLINE_SHELL, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = (await cache.match(OFFLINE_SHELL)) || (await caches.match(OFFLINE_SHELL));
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>'
        + '<p style="font:16px system-ui;padding:2rem">Civ1 Browser is offline and has no cached copy '
        + 'of the app yet. Reconnect once to install it.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

/**
 * Cache-first for immutable files, stale-while-revalidate for the large
 * game assets.
 */
async function cacheFirst(request) {
  // The shell holds the hashed build output. Its filenames carry a content
  // hash, so it never changes and never needs revalidating — re-fetching it
  // would only duplicate megabytes in the runtime cache.
  const shell = await caches.open(SHELL_CACHE);
  const shellHit = await shell.match(request);
  if (shellHit) return shellHit;

  const cached = await caches.match(request);
  if (cached) {
    // Revalidate in the background so a changed tile is picked up without
    // making the player wait for it.
    revalidate(request);
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone()).catch(() => undefined);
    trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
  }
  return response;
}

/** Refresh a cached entry in the background. Failures are ignored. */
function revalidate(request) {
  fetch(request)
    .then(async (response) => {
      if (!response || !response.ok || response.type !== 'basic') return;
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response);
      await trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES);
    })
    .catch(() => undefined);
}

/** Drop the oldest entries so the cache stays within its budget. */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.slice(0, keys.length - maxEntries);
  await Promise.all(excess.map((key) => cache.delete(key)));
}
