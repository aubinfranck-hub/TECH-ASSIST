/* Tech Assist : notifications de la console technicien (Web Push). Aucune donnée n'est mise en cache. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Tech Assist';
  const url = typeof data.url === 'string' ? data.url : '/technicien';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: url, // une seule notification par demande
      renotify: true,
      requireInteraction: true,
      vibrate: [200, 100, 200, 100, 400],
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Seules les adresses de ce site sont ouvertes.
  let target = '/technicien';
  try {
    const raw = event.notification.data && typeof event.notification.data.url === 'string' ? event.notification.data.url : '/technicien';
    const u = new URL(raw, self.location.origin);
    if (u.origin === self.location.origin) target = u.pathname + u.search;
  } catch (e) {
    /* adresse invalide : on ouvre la console */
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ('focus' in w && w.url.startsWith(self.location.origin)) {
          if ('navigate' in w) return w.navigate(target).then((c) => (c || w).focus());
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
