import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import LearningButton from './components/LearningButton'
import { API_BASE, type LearningStatus, type TranslationCard } from './types'

const STORAGE_KEY = 'deutsch-uben:last-card-index'

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return 0
  }
  const normalized = index % length
  return normalized < 0 ? normalized + length : normalized
}

function App() {
  const [allCards, setAllCards] = useState<TranslationCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [newOnly, setNewOnly] = useState(false)

  const cards = useMemo(() => {
    if (!newOnly) return allCards
    return [...allCards].sort((a, b) => b.id - a.id).slice(0, 100)
  }, [allCards, newOnly])

  const [index, setIndex] = useState(0)
  const [indexRestored, setIndexRestored] = useState(false)
  const [isFlipped, setIsFlipped] = useState(false)
  const [disableFlipTransition, setDisableFlipTransition] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/cards`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((data: TranslationCard[]) => {
        if (cancelled) return
        setAllCards(data)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Honor ?card=<id> on first load, falling back to localStorage or random.
  useEffect(() => {
    if (indexRestored || allCards.length === 0) return
    const cardParam = searchParams.get('card')
    if (cardParam) {
      const id = Number(cardParam)
      const idx = allCards.findIndex((c) => c.id === id)
      if (idx >= 0) {
        setIndex(idx)
        setIndexRestored(true)
        // Clear the query param so refreshes don't re-jump.
        const next = new URLSearchParams(searchParams)
        next.delete('card')
        setSearchParams(next, { replace: true })
        return
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < allCards.length) {
      setIndex(parsed)
    } else {
      setIndex(Math.floor(Math.random() * allCards.length))
    }
    setIndexRestored(true)
  }, [allCards, indexRestored, searchParams, setSearchParams])

  useEffect(() => {
    if (cards.length > 0 && index >= cards.length) {
      setIndex(clampIndex(index, cards.length))
    }
  }, [cards.length, index])

  useEffect(() => {
    if (cards.length === 0) {
      return
    }
    localStorage.setItem(STORAGE_KEY, String(index))
  }, [index, cards.length])

  useEffect(() => {
    setIsFlipped(false)
    setDisableFlipTransition(true)
    const frame = requestAnimationFrame(() => {
      setDisableFlipTransition(false)
    })
    if (pageRef.current) {
      pageRef.current.scrollTo({ top: 0 })
    }
    return () => cancelAnimationFrame(frame)
  }, [index])

  const activeCard = cards[index]
  const total = cards.length
  const displayIndex = total > 0 ? index + 1 : 0

  const goPrev = useCallback(() => {
    if (total === 0) return
    setIndex((current) => clampIndex(current - 1, total))
  }, [total])

  const goNext = useCallback(() => {
    if (total === 0) return
    setIndex((current) => clampIndex(current + 1, total))
  }, [total])

  const goRandom = useCallback(() => {
    if (total === 0) return
    setIndex(Math.floor(Math.random() * total))
  }, [total])

  const [isRipping, setIsRipping] = useState(false)

  const deleteCard = useCallback(() => {
    if (!activeCard || isRipping) return
    setIsRipping(true)
    const doomedId = activeCard.id

    setTimeout(() => {
      setAllCards((prev) => prev.filter((c) => c.id !== doomedId))
      setIsRipping(false)

      fetch(`${API_BASE}/api/cards/${doomedId}`, { method: 'DELETE' }).catch(() => {})

      const newTotal = total - 1
      if (newTotal > 0 && index >= newTotal) {
        setIndex(newTotal - 1)
      }
    }, 500)
  }, [activeCard, index, total, isRipping])

  const updateLearningStatus = useCallback((cardId: number, next: LearningStatus) => {
    setAllCards((prev) =>
      prev.map((c) =>
        c.id === cardId
          ? {
              ...c,
              learning_status: next,
              // Don't try to mirror days here — server is the source of truth.
              learning_days_remaining: next === null ? null : c.learning_days_remaining,
            }
          : c,
      ),
    )
  }, [])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
      else if (e.key === 'Backspace' || e.key === 'Delete') deleteCard()
      else if (e.key === ' ') { e.preventDefault(); setIsFlipped((c) => !c) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goNext, goPrev, deleteCard])

  if (!loaded) {
    return (
      <main className="app">
        <p style={{ color: '#94a3b8' }}>Loading…</p>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="app app-empty">
        <p>Could not load cards: {loadError}</p>
      </main>
    )
  }

  if (total === 0) {
    return (
      <main className="app app-empty">
        <p>No cards available.</p>
      </main>
    )
  }

  return (
    <div className="page-scroll" ref={pageRef}>
      <main className="app">
        <div className="index-badge">
          {displayIndex} / {total}
        </div>
        <button
          className={`new-badge${newOnly ? ' active' : ''}`}
          type="button"
          onClick={() => {
            setNewOnly((v) => !v)
            setIndex(0)
          }}
        >
          Новое
        </button>
        <div className="card-wrapper">
          <button
            className={`card ${isFlipped ? 'is-flipped' : ''} ${
              disableFlipTransition ? 'no-transition' : ''
            }`}
            type="button"
            onClick={() => setIsFlipped((current) => !current)}
            aria-pressed={isFlipped}
            aria-label="Flip card"
          >
            <div className="card-inner">
              <div className="card-face card-front">
                <p>{activeCard.source_text}</p>
              </div>
              <div className="card-face card-back">
                <p>{activeCard.target_text}</p>
              </div>
            </div>
          </button>
          {isRipping && (
            <div className="shatter-overlay">
              {[...Array(9)].map((_, i) => (
                <div key={i} className={`shard shard-${i}`} />
              ))}
            </div>
          )}
          <LearningButton
            cardId={activeCard.id}
            status={activeCard.learning_status}
            onStatusChange={(next) => updateLearningStatus(activeCard.id, next)}
          />
          <button
            className="delete-btn"
            type="button"
            onClick={deleteCard}
            aria-label="Delete card"
            title="Delete card"
          >
            ×
          </button>
        </div>
        <div className="controls">
          <button type="button" onClick={goPrev}>
            Previous
          </button>
          <button type="button" onClick={goRandom}>
            Random
          </button>
          <button type="button" onClick={goNext}>
            Next
          </button>
        </div>
      </main>
      {activeCard.examples_html && (
        <section
          className="examples"
          dangerouslySetInnerHTML={{ __html: activeCard.examples_html }}
        />
      )}
    </div>
  )
}

export default App
