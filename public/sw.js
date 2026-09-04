// sw.js - Service Worker for NOVA Messenger (Push Notifications & PWA)
const CACHE_NAME = 'nova-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle Background Push Events
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'NOVA', body: event.data.text() };
    }
  }

  const title = data.title || 'NOVA Messenger';
  const options = {
    body: data.body || 'Nuovo messaggio ricevuto',
    icon: data.icon || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='25' fill='%2310b981'/><text x='50' y='65' font-size='48' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='900'>✦</text></svg>",
    badge: data.icon,
    vibrate: data.vibrate || [200, 100, 200],
    data: data.data || {},
    tag: data.tag || 'nova-message',
    renotify: true,
    requireInteraction: !!data.requireInteraction
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Handle Notification Click (Focus window or open chat)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const conversationId = event.notification.data ? event.notification.data.conversationId : null;
  const targetUrl = conversationId ? `/?conv=${conversationId}` : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (conversationId) {
            client.postMessage({ type: 'NAVIGATE_CONVERSATION', conversationId });
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
