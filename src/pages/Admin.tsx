import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../types'

type NotifyResult = {
  short: number
  long: number
  sent: number
  failed: number
  expired: number
  skipped: boolean
}

export default function Admin() {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<NotifyResult | { error: string } | null>(null)

  const sendNotification = async () => {
    if (busy) return
    setBusy(true)
    setLast(null)
    try {
      const res = await fetch(`${API_BASE}/api/admin/notify`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setLast({ error: data?.error ?? `${res.status} ${res.statusText}` })
      } else {
        setLast(data as NotifyResult)
      }
    } catch (err) {
      setLast({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const resultLabel = (() => {
    if (!last) return null
    if ('error' in last) return `Error: ${last.error}`
    if (last.skipped) return 'VAPID keys not configured on the server.'
    if (last.short === 0 && last.long === 0) return 'No cards due right now — nothing sent.'
    return `Sent=${last.sent} · failed=${last.failed} · expired=${last.expired} (short=${last.short}, long=${last.long})`
  })()

  return (
    <main className="app admin-page">
      <button
        type="button"
        className="close-btn"
        onClick={() => navigate('/')}
        aria-label="Close"
        title="Close"
      >
        ×
      </button>
      <h1 className="learning-title">Admin</h1>
      <div className="admin-actions">
        <button
          type="button"
          className="admin-btn"
          onClick={sendNotification}
          disabled={busy}
        >
          {busy ? 'Sending…' : 'Send notification'}
        </button>
        {resultLabel && <p className="admin-result">{resultLabel}</p>}
      </div>
    </main>
  )
}
