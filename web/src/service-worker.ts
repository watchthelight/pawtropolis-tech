/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

self.addEventListener('notificationclick', (event) => {
	const { appId } = event.notification.data ?? {};
	event.notification.close();

	if (!appId) return;

	if (event.action === 'claim') {
		event.waitUntil(
			fetch('/api/review/claim', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ appId })
			})
				.then(() => focusOrOpen(`/dashboard/reviews/${appId}`))
				.catch(() => focusOrOpen(`/dashboard/reviews/${appId}`))
		);
	} else {
		event.waitUntil(focusOrOpen(`/dashboard/reviews/${appId}`));
	}
});

async function focusOrOpen(url: string) {
	const allClients = await self.clients.matchAll({ type: 'window' });
	for (const client of allClients) {
		if (client.url.includes('/dashboard')) {
			client.focus();
			(client as WindowClient).navigate(url);
			return;
		}
	}
	return self.clients.openWindow(url);
}

export {};
