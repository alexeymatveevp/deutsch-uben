import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, type TranslationCard } from '../types'

function fetchStatus(status: 'short' | 'long'): Promise<TranslationCard[]> {
  return fetch(`${API_BASE}/api/cards/learning?status=${status}`).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
    return r.json()
  })
}

export default function LearningList() {
  const [longCards, setLongCards] = useState<TranslationCard[]>([])
  const [shortCards, setShortCards] = useState<TranslationCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setError(null)
    Promise.all([fetchStatus('long'), fetchStatus('short')])
      .then(([longData, shortData]) => {
        if (cancelled) return
        setLongCards(longData)
        setShortCards(shortData)
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

  const total = longCards.length + shortCards.length

  const renderRow = (c: TranslationCard) => (
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
  )

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
      {loaded && !error && total === 0 && (
        <p className="learning-empty">Сегодня нечего повторять.</p>
      )}
      {loaded && !error && longCards.length > 0 && (
        <section className="learning-section">
          <h2 className="learning-title">С прошлой недели</h2>
          <ul className="learning-list">{longCards.map(renderRow)}</ul>
        </section>
      )}
      {loaded && !error && shortCards.length > 0 && (
        <section className="learning-section">
          <h2 className="learning-title">Вчерашние слова</h2>
          <ul className="learning-list">{shortCards.map(renderRow)}</ul>
        </section>
      )}
    </main>
  )
}
