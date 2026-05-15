import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, type TranslationCard } from '../types'

type Props = {
  category: 'ausdruck' | 'favorite'
  title: string
  emptyText: string
}

export default function CategoryList({ category, title, emptyText }: Props) {
  const [cards, setCards] = useState<TranslationCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError(null)
    fetch(`${API_BASE}/api/cards/category?value=${category}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json() as Promise<TranslationCard[]>
      })
      .then((data) => {
        if (cancelled) return
        setCards(data)
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
  }, [category])

  return (
    <main className="app learning-page">
      <button
        type="button"
        className="close-btn"
        onClick={() => navigate('/')}
        aria-label="Close"
        title="Close"
      >
        ×
      </button>
      {!loaded && <p className="learning-empty">Loading…</p>}
      {loaded && error && <p className="learning-empty">Could not load: {error}</p>}
      {loaded && !error && cards.length === 0 && (
        <p className="learning-empty">{emptyText}</p>
      )}
      {loaded && !error && cards.length > 0 && (
        <section className="learning-section">
          <h2 className="learning-title">{title}</h2>
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
        </section>
      )}
    </main>
  )
}
