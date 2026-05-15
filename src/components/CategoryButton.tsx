import { useState } from 'react'
import { API_BASE, type CardCategory } from '../types'

type Props = {
  cardId: number
  target: 'ausdruck' | 'favorite'
  current: CardCategory
  onCategoryChange: (next: CardCategory) => void
}

const TITLES: Record<'ausdruck' | 'favorite', { idle: string; active: string }> = {
  ausdruck: {
    idle: 'Пометить как выражение',
    active: 'Снять пометку «выражение»',
  },
  favorite: {
    idle: 'Добавить в избранное',
    active: 'Убрать из избранного',
  },
}

export default function CategoryButton({ cardId, target, current, onCategoryChange }: Props) {
  const [busy, setBusy] = useState(false)
  const active = current === target

  const click = async () => {
    if (busy) return
    const prev = current
    const next: CardCategory = active ? null : target
    onCategoryChange(next)
    setBusy(true)
    try {
      const res = await fetch(`${API_BASE}/api/cards/${cardId}/category`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: next }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      onCategoryChange(prev)
    } finally {
      setBusy(false)
    }
  }

  const title = active ? TITLES[target].active : TITLES[target].idle
  const className = `category-btn ${target}${active ? ' active' : ''}${busy ? ' busy' : ''}`
  const fill = active ? 'currentColor' : 'none'

  return (
    <button
      type="button"
      className={className}
      onClick={click}
      aria-pressed={active}
      aria-label={title}
      title={title}
    >
      {target === 'ausdruck' ? (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill={fill}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a8 8 0 1 1-3.6-6.7L21 4l-1.3 4.6A8 8 0 0 1 21 12Z" />
        </svg>
      ) : (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill={fill}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2.5 14.9 9l7.1.6-5.4 4.7 1.7 7-6.3-3.8-6.3 3.8 1.7-7L2 9.6 9.1 9 12 2.5Z" />
        </svg>
      )}
    </button>
  )
}
