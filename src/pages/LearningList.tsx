import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, type TranslationCard } from '../types'

type Props = {
  status: 'short' | 'long'
}

export default function LearningList({ status }: Props) {
  const [cards, setCards] = useState<TranslationCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError(null)
    fetch(`${API_BASE}/api/cards/learning?status=${status}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data: TranslationCard[]) => {
        if (!cancelled) setCards(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [status])

  const title = status === 'short' ? 'Short reviews' : 'Long reviews'

  return (
    <main className="app learning-page">
      <h1 className="learning-title">{title}</h1>
      {!loaded && <p className="learning-empty">Loading…</p>}
      {loaded && error && <p className="learning-empty">Could not load: {error}</p>}
      {loaded && !error && cards.length === 0 && (
        <p className="learning-empty">No cards due right now.</p>
      )}
      {loaded && !error && cards.length > 0 && (
        <ul className="learning-list">
          {cards.map((c) => (
            <li
              key={c.id}
              className="learning-row"
              onClick={() => navigate(`/?card=${c.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(`/?card=${c.id}`)
                }
              }}
            >
              <span className="learning-source">{c.source_text}</span>
              <span className="learning-target">{c.target_text}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
