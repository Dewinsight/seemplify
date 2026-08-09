self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  event.waitUntil(self.registration.showNotification(payload.title || 'Time & Attendance', {
    body: payload.body || 'You have a new attendance notification.',
    data: { url: payload.url || '/notifications' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/notifications'));
});
