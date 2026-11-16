/**
 * The service worker: it keeps the app's own files (the "shell") so that, once the app has been
 * opened, it opens again with no network — and the author's songs, which live on the device, are
 * there. It does not cache songs from the bank or piano samples; that is Stage 9.
 *
 * It must never make the app staler than the network would: a page is always asked of the network
 * first and only served from the cache when there is no network. The app's other files have their
 * contents in their names, so a cached one is by definition the right one.
 */

// The few service-worker types used here, declared by hand: the app's TypeScript configuration is
// for pages, and its DOM library has no ServiceWorkerGlobalScope.
interface ExtendableEventLike extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}
interface WorkerScope {
  addEventListener(type: "install" | "activate", listener: (e: ExtendableEventLike) => void): void;
  addEventListener(type: "fetch", listener: (e: FetchEventLike) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  registration: { scope: string };
  location: Location;
}
const worker = self as unknown as WorkerScope;

/** Filled in by the build (vite.config.ts): every file of the app, and a name for this set of them. */
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

const CACHE = `shell-${__VERSION__}`;
const SHELL = "index.html";

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Each file on its own: one that fails to download must not stop the rest being kept.
      await Promise.all(
        [SHELL, ...__PRECACHE__].map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined)),
      );
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith("shell-") && name !== CACHE) await caches.delete(name);
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  const scope = new URL(worker.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  const path = url.pathname.slice(scope.length);

  if (request.mode === "navigate") {
    // The page itself: the network's copy when there is one, so a new version is never held back.
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) void caches.open(CACHE).then((c) => c.put(SHELL, fresh.clone()));
          return fresh;
        } catch {
          return (await caches.match(SHELL, { cacheName: CACHE })) ?? Response.error();
        }
      })(),
    );
    return;
  }
  // The app's own files, whose names change when their contents do: the kept copy is the right one.
  if (path.startsWith("assets/") || path.startsWith("icons/") || path === "manifest.webmanifest") {
    event.respondWith(
      (async () => {
        // By address alone: a server's Vary header must not make a kept file look like a different one.
        const kept = await caches.match(request.url, { cacheName: CACHE, ignoreVary: true });
        if (kept) return kept;
        const fresh = await fetch(request);
        if (fresh.ok) void caches.open(CACHE).then((c) => c.put(request, fresh.clone()));
        return fresh;
      })(),
    );
  }
  // Everything else — songs, samples — goes to the network as if this worker were not here.
});
