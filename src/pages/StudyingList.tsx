import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, type StudyingCard } from '../types'

export default function StudyingList() {
  const [cards, setCards] = useState<StudyingCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError(null)
    fetch(`${API_BASE}/api/cards/learning/all`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json() as Promise<StudyingCard[]>
      })
      .then((data) => {
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
  }, [])

  const open = (id: number) => navigate(`/?card=${id}`)

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
        <p className="learning-empty">Сейчас нет карточек в обучении.</p>
      )}
      {loaded && !error && cards.length > 0 && (
        <section className="learning-section">
          <h2 className="learning-title">В обучении</h2>
          <div className="studying-table" role="table">
            <div className="studying-row studying-head" role="row">
              <span role="columnheader">Оригинал</span>
              <span role="columnheader">Перевод</span>
              <span role="columnheader" className="studying-days">
                Дней в обучении
              </span>
            </div>
            {cards.map((c) => (
              <div
                key={c.id}
                className="studying-row"
                role="row"
                onClick={() => open(c.id)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    open(c.id)
                  }
                }}
              >
                <span className="learning-source" role="cell">
                  {c.source_text}
                </span>
                <span className="learning-target" role="cell">
                  {c.target_text}
                </span>
                <span className="studying-days" role="cell">
                  {c.learning_days_ago}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
