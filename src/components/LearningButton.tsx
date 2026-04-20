import { useState } from 'react'
import { API_BASE, type LearningStatus } from '../types'

type Props = {
  cardId: number
  status: LearningStatus
  onStatusChange: (next: LearningStatus) => void
}

export default function LearningButton({ cardId, status, onStatusChange }: Props) {
  const [busy, setBusy] = useState(false)
  const active = status !== null

  const click = async () => {
    if (busy) return
    const prev = status
    const optimistic: LearningStatus = prev === null ? 'short' : null
    onStatusChange(optimistic)
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE}/api/cards/${cardId}/learning`, {
        method: prev === null ? 'POST' : 'DELETE',
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      onStatusChange(prev)
    } finally {
      setBusy(false)
    }
  }

  const title =
    status === 'short'
      ? 'Learning (short phase) — click to reset'
      : status === 'long'
      ? 'Learning (long phase) — click to reset'
      : 'Start learning this card'

  return (
    <button
      type="button"
      className={`learning-btn${active ? ' active' : ''}${busy ? ' busy' : ''}`}
      onClick={click}
      aria-pressed={active}
      aria-label={title}
      title={title}
    >
      {/* Graduation cap SVG */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 10 12 5 2 10l10 5 10-5Z"/>
        <path d="M6 12v5a2 2 0 0 0 1 1.7c1.4 1 3 1.3 5 1.3s3.6-.3 5-1.3A2 2 0 0 0 18 17v-5"/>
      </svg>
    </button>
  )
}
