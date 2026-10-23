/// <reference lib="webworker" />
// The service worker: a proxy you write yourself. It sits between the page
// and the network and answers requests from Cache Storage when it should.
//
// Strategies, by route:
//   app shell (/, JS, CSS, icons)         cache-first; precached on install
//   Google Fonts                           cache-first into its own cache
//   GET /api/...                           network-first, 3 s timeout, cached fallback
//   GET /api/v1/ping                       network-only; a cached probe would lie
//   event streams (Accept: text/event-stream)  not handled; a timeout or a cache
//                                          would cut a stream that is meant to stay open
//   anything that is not a GET             not handled; writes never get a cached answer
//
// Lifecycle: install precaches the list the build emitted; activate deletes
// every other shell cache. skipWaiting() is only ever called when the page
// asks for it after the user chose to reload.

declare const self: ServiceWorkerGlobalScope;
declare const __BUILD_ID__: string;

const SHELL = `shell-${__BUILD_ID__}`;
const API = 'api-fallback';
const FONTS = 'fonts';
const API_TIMEOUT_MS = 3000;

interface PrecacheManifest {
  buildId: string;
  files: string[];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        const res = await fetch('/precache.json', { cache: 'no-store' });
        const manifest = (await res.json()) as PrecacheManifest;
        await cache.addAll(manifest.files);
      } catch {
        // Dev server or a missing manifest: cache the entry point only.
        await cache.addAll(['/']);
      }
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('shell-') && n !== SHELL).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// Background Sync fires this when connectivity returns, even with the tab
// closed on Chromium. The drain itself needs the page (it holds the session
// and the app's send logic), so we wake any open client.
self.addEventListener('sync', (event: Event) => {
  const sync = event as ExtendableEvent & { tag?: string };
  if (sync.tag !== 'drain-outbox') return;
  sync.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const c of clients) c.postMessage({ type: 'drain' });
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.get('Accept')?.includes('text/event-stream')) return;
  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.endsWith('/ping')) return;
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== self.location.origin) return;
  event.respondWith(cacheFirst(req, SHELL));
});

async function cacheFirst(req: Request, name: string): Promise<Response> {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    // Fonts arrive as CORS responses; the shell as basic. Both are cacheable.
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Single-page app: any navigation can be served by the cached shell.
    if (req.mode === 'navigate') {
      const shell = await cache.match('/');
      if (shell) return shell;
    }
    throw err;
  }
}

async function networkFirst(req: Request): Promise<Response> {
  const cache = await caches.open(API);
  try {
    const res = await fetch(req, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) {
      // Tell the app it is looking at the last known copy.
      const headers = new Headers(hit.headers);
      headers.set('X-From-Cache', '1');
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    }
    throw err;
  }
}
