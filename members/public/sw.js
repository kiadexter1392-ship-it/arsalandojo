/* Scope-aware static cache. Never store authenticated pages or API responses. */
const CACHE_NAME = 'arslan-dojo-static-v8-' + new URL(self.registration.scope).pathname;
const ASSETS = ['ui/style.css', 'ui/shell.css', 'ui/ui.js', 'ui/jalali.browser.js', 'ui/icons/icon-192.png', 'panel-overview.css', 'panel-extras.js']
  .map(path => new URL(path, self.registration.scope).href);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.allSettled(ASSETS.map(url => cache.add(url))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME && k.startsWith('arslan-dojo-')).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin ||
      !url.pathname.startsWith(scope.pathname) || request.mode === 'navigate') return;
  const relative = url.pathname.slice(scope.pathname.length);
  const isStatic = /^(ui\/|images\/)/.test(relative) || /^(dashboard|panel|panel-extras|panel-overview|care|login|CardStack|CardSwap|StackedBars|OneTimeCode|ToastStack)\.(js|css)$/.test(relative);
  if (!isStatic || !/\.(css|js|png|jpg|jpeg|svg|woff2?)$/.test(relative)) return;

  // Network first so deployed design and routing fixes are not masked by stale assets.
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});
