const CACHE = "fd-v144";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./assets/logos/icon-dark.svg",
  "./assets/logos/icon-light.svg",
  "./assets/logos/icon-amber.svg",
  "./css/variables.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/pages.css",
  "./js/data.js",
  "./js/utils.js",
  "./js/charts.js",
  "./js/app.js",
  "./js/pages/networth.js",
  "./js/pages/transactions.js",
  "./js/pages/budgets.js",
  "./js/pages/scheduled.js",
  "./js/pages/accounts.js",
  "./js/pages/dashboard.js",
  "./js/pages/goals.js",
  "./js/pages/insights.js",
  "./js/pages/settings.js",
  "./js/pages/forecast.js",
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Space+Grotesk:wght@500;600;700&display=swap"
];

// Cache each asset INDIVIDUALLY (best-effort). addAll() is atomic — one failed
// fetch (e.g. the cross-origin Google Fonts URL, or a transient protocol hiccup)
// would reject the whole batch and leave this cache version EMPTY. An empty new
// cache + the activate step deleting the old cache = every asset 404s = a fully
// blank app. allSettled + individual add() guarantees the local app files get
// cached even if a remote asset fails.
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // Only retire old caches once THIS cache is actually populated — never
    // delete the last working copy and strand the app with nothing to serve.
    const c = await caches.open(CACHE);
    const ready = (await c.keys()).length > 0;
    if (ready) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    }
    await self.clients.claim();
    // After an SW update, force any open window(s) to reload so they pick up
    // the new bundle on the very first launch — no more "old UI until reload".
    try {
      const wins = await self.clients.matchAll({ type: "window" });
      wins.forEach(w => { try { w.navigate(w.url); } catch {} });
    } catch {}
  })());
});

// NETWORK-FIRST for app assets. Tauri serves bundled files via the tauri://
// protocol, which is always available — so a fresh install's assets always
// win over any stale cache from an older SW. Cache is kept only as an offline
// fallback (and to absorb cross-origin font requests that may flake).
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith((async () => {
    try {
      const net = await fetch(e.request);
      if (net && net.status === 200 && net.type !== "opaqueredirect") {
        const copy = net.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return net;
    } catch {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (e.request.mode === "navigate") {
        return (await caches.match("./index.html")) || (await caches.match("./")) || Response.error();
      }
      return Response.error();
    }
  })());
});
