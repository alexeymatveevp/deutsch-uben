import { NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { API_BASE } from '../types'

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function getExistingSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

async function enableReminders(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert('Push notifications are not supported on this device/browser.')
    return false
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return false

  const keyRes = await fetch(`${API_BASE}/api/push/vapid-public-key`)
  if (!keyRes.ok) {
    alert('Server has no VAPID key configured.')
    return false
  }
  const { key } = (await keyRes.json()) as { key: string }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    })
  }

  await fetch(`${API_BASE}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
  return true
}

async function disableReminders(): Promise<boolean> {
  const sub = await getExistingSubscription()
  if (!sub) return false
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await fetch(`${API_BASE}/api/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  })
  return true
}

export default function Header() {
  const [permission, setPermission] = useState<PermissionState>(() => {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission as PermissionState
  })
  const [subscribed, setSubscribed] = useState<boolean>(false)

  useEffect(() => {
    getExistingSubscription().then((s) => setSubscribed(!!s))
  }, [])

  const handleBellClick = async () => {
    if (permission === 'unsupported') return
    if (subscribed) {
      const ok = await disableReminders()
      if (ok) setSubscribed(false)
      return
    }
    const ok = await enableReminders()
    if (ok) {
      setSubscribed(true)
      setPermission('granted')
    } else {
      setPermission(Notification.permission as PermissionState)
    }
  }

  const bellTitle =
    permission === 'unsupported'
      ? 'Push not supported on this device'
      : permission === 'denied'
      ? 'Notifications denied in browser settings'
      : subscribed
      ? 'Reminders on — click to disable'
      : 'Enable learning reminders'

  return (
    <header className="app-header">
      <nav className="header-tabs">
        <NavLink
          to="/learning"
          className={({ isActive }) => `header-tab${isActive ? ' active' : ''}`}
          end
        >
          Посмотреть сегодня
        </NavLink>
      </nav>
      <button
        className={`bell-btn${subscribed ? ' active' : ''}`}
        type="button"
        onClick={handleBellClick}
        disabled={permission === 'unsupported' || permission === 'denied'}
        title={bellTitle}
        aria-label={bellTitle}
      >
        {subscribed ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6v-5a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
          </svg>
        )}
      </button>
    </header>
  )
}
