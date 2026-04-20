/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

type PushPayload = {
  title?: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let data: PushPayload = {}
  try {
    data = event.data ? (event.data.json() as PushPayload) : {}
  } catch {
    data = { title: 'Deutsch Uben', body: event.data?.text?.() ?? '' }
  }

  const title = data.title || 'Deutsch Uben'
  const options: NotificationOptions = {
    body: data.body ?? '',
    data: { url: data.url ?? '/' },
    icon: '/icons/app-icon.svg',
    badge: '/icons/app-icon.svg',
    tag: data.tag,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        try {
          const u = new URL(client.url)
          if (u.pathname === target || client.url.endsWith(target)) {
            if ('focus' in client) return client.focus()
          }
        } catch {
          // ignore
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target)
      return undefined
    })(),
  )
})

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
