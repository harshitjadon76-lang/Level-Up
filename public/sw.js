self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : "You have a reminder." }; }
  const title = typeof payload.title === "string" ? payload.title.slice(0, 120) : "Level Up reminder";
  const options = {
    body: typeof payload.body === "string" ? payload.body.slice(0, 500) : "Open Level Up to review your plan.",
    icon: typeof payload.icon === "string" ? payload.icon : "/icon-192.png",
    badge: typeof payload.badge === "string" ? payload.badge : "/icon-192.png",
    tag: typeof payload.tag === "string" ? payload.tag.slice(0, 180) : "levelup-reminder",
    data: { url: typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/" },
    renotify: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url : "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of wins) {
      if ("focus" in client) {
        if ("navigate" in client) {
          try { await client.navigate(path); } catch { /* Keep the existing page focused. */ }
        }
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(path);
  })());
});
