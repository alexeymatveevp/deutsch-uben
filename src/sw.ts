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
  // "learning" becomes e.g. https://host/deutsch-uben/learning under a
  // deploy prefix, or https://host/learning at root.
  const fullUrl = new URL(raw, self.registration.scope).toString()
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Prefer focusing an existing app window and ask it to navigate
      // client-side via react-router. iOS PWAs ignore WindowClient.navigate(),
      // but postMessage + in-app navigate() is reliable everywhere.
      for (const client of all) {
        if (client.url.startsWith(self.registration.scope)) {
          const win = client as WindowClient
          try {
            await win.focus()
          } catch {
            // ignore
          }
          win.postMessage({ type: 'sw-navigate', path: raw })
          return
        }
      }
      // No existing window — open a fresh one at the target URL.
      if (self.clients.openWindow) {
        await self.clients.openWindow(fullUrl)
      }
    })(),
  )
})

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting()
  }
})
