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
  const raw = (event.notification.data as { url?: string } | undefined)?.url ?? ''
  // Resolve against the SW's registration scope so a relative path like
  // "learning/short" becomes e.g. https://host/deutsch-uben/learning/short
  // under a deploy prefix, or https://host/learning/short at root.
  const fullUrl = new URL(raw, self.registration.scope).toString()
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of all) {
        if (client.url === fullUrl && 'focus' in client) return client.focus()
      }
      for (const client of all) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          const win = client as WindowClient
          await win.focus()
          if (typeof win.navigate === 'function') return win.navigate(fullUrl)
          return undefined
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(fullUrl)
      return undefined
    })(),
  )
})

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
