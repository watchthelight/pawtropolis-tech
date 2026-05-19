/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// Take control immediately on install so notifications work on first page load
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ---------------------------------------------------------------------------
// Web Push: receive server-sent push notifications
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: {
    title: string;
    body: string;
    icon?: string;
    data?: Record<string, unknown>;
    actions?: Array<{ action: string; title: string }>;
  };
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: payload.data,
      actions: payload.actions,
    })
  );
});

// ---------------------------------------------------------------------------
// Notification click: navigate to the relevant dashboard page
// ---------------------------------------------------------------------------

self.addEventListener("notificationclick", (event) => {
  const { url, appId } = event.notification.data ?? {};
  event.notification.close();

  // "Claim" action: POST to API then navigate
  if (event.action === "claim" && appId) {
    event.waitUntil(
      fetch("/api/review/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
      })
        .then(() => focusOrOpen(url || `/dashboard/reviews/${appId}`))
        .catch(() => focusOrOpen(url || `/dashboard/reviews/${appId}`))
    );
  } else {
    event.waitUntil(focusOrOpen(url || "/dashboard"));
  }
});

async function focusOrOpen(url: string) {
  const allClients = await self.clients.matchAll({ type: "window" });
  for (const client of allClients) {
    if (client.url.includes("/dashboard")) {
      client.focus();
      (client as WindowClient).navigate(url);
      return;
    }
  }
  return self.clients.openWindow(url);
}

export {};
