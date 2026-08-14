const CACHE_NAME = 'outfitbot-pwa-v9';

// Важно: на GitHub Pages cache.addAll() может сорвать установку всего SW,
// если хотя бы один файл не найден или отдал HTML вместо JS/PNG.
// Поэтому кэшируем каждый файл отдельно и не валим install из-за одной ошибки.
const APP_SHELL = [
  './',
  './index.html',
  './outfit_bot.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(
    APP_SHELL.map(async url => {
      try {
        const request = new Request(url, { cache: 'reload' });
        const response = await fetch(request);
        if (response && response.ok) {
          await cache.put(request, response.clone());
        }
      } catch (e) {
        // Не прерываем установку Service Worker из-за отдельного файла.
      }
    })
  );
}

self.addEventListener('install', event => {
  event.waitUntil(
    cacheAppShell().then(() => self.skipWaiting())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'PING') {
    if (event.source && event.source.postMessage) {
      event.source.postMessage({
        type: 'PONG',
        cacheName: CACHE_NAME,
        scope: self.registration.scope
      });
    }
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(key => key === CACHE_NAME ? null : caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Прогноз погоды: сначала сеть, затем кэш.
  if (url.hostname.includes('open-meteo.com')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Навигация внутри PWA: если сеть недоступна, открываем закэшированное приложение.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          return await caches.match('./outfit_bot.html') || await caches.match('./index.html');
        })
    );
    return;
  }

  // Статика приложения: сначала кэш, затем сеть.
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./outfit_bot.html');
    })
  );
});

