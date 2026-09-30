// melodyflix - Service Worker for PWA
const CACHE_NAME = 'melodyflix-v1';
const OFFLINE_URL = '/offline.html';

// Assets that should always be cached (app shell)
const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/logo.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// Install — precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('Precache failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — network-first with cache fallback for navigation, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip cross-origin
  if (url.origin !== self.location.origin) return;

  // Skip API calls — always live
  if (url.pathname.startsWith('/api/')) return;

  // Skip HLS streams (m3u8, ts)
  if (url.pathname.endsWith('.m3u8') || url.pathname.endsWith('.ts')) return;
  if (url.pathname.includes('/stream/') || url.pathname.includes('/hls/')) return;

  // Skip video files
  if (/\.(mp4|webm|mkv|mov)$/i.test(url.pathname)) return;

  // Skip websockets etc.
  if (url.pathname.startsWith('/ws')) return;

  // Navigation requests — network first, fallback to offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r ?? new Response('Offline', { status: 503 })))
    );
    return;
  }

  // Static assets (JS, CSS, images, fonts) — cache-first, then network
  if (/\.(js|css|png|jpg|jpeg|svg|webp|woff2?|ttf|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          // Cache successful responses
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached ?? new Response('', { status: 504 }));
      })
    );
    return;
  }

  // Everything else — network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request).then((r) => r ?? new Response('Offline', { status: 503 })))
  );
});


// ==================== PUSH NOTIFICATIONS ====================

// Receive push notification
self.addEventListener('push', (event) => {
  let data = {
    title: 'melodyflix',
    body: 'You have a new notification',
    icon: '/icons/icon-192.png',
    url: '/',
    tag: 'melodyflix',
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (err) {
    // Fallback to text if not JSON
    try {
      data.body = event.data?.text() ?? data.body;
    } catch {}
  }

  const options = {
    body: data.body,
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'melodyflix',
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click — focus or open the URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Try to focus an existing tab
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        // Otherwise open a new tab
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
  );
});
