import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import allData from './data/data.json'

type TranslationCard = {
  id: number
  source_text: string
  target_text: string
  examples_html: string | null
  deleted?: boolean
}

const STORAGE_KEY = 'deutsch-uben:last-card-index'
const PANTRY_ID = import.meta.env.VITE_PANTRY_ID as string | undefined
const BASKET = 'deleted-cards'
const PANTRY_URL = PANTRY_ID
  ? `https://getpantry.cloud/apiv1/pantry/${PANTRY_ID}/basket/${BASKET}`
  : null

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return 0
  }
  const normalized = index % length
  return normalized < 0 ? normalized + length : normalized
}

function App() {
  const allCards = useMemo(() => allData as TranslationCard[], [])
  const [deletedIds, setDeletedIds] = useState<Set<number>>(new Set())
  const [loaded, setLoaded] = useState(false)

  const cards = useMemo(
    () => allCards.filter((c) => !c.deleted && !deletedIds.has(c.id)),
    [allCards, deletedIds]
  )

  const [index, setIndex] = useState(() => {
    if (allCards.length === 0) {
      return 0
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < allCards.length) {
      return parsed
    }
    return Math.floor(Math.random() * allCards.length)
  })
  const [isFlipped, setIsFlipped] = useState(false)
  const [disableFlipTransition, setDisableFlipTransition] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)

  // Fetch deleted IDs from Pantry on mount
  useEffect(() => {
    if (!PANTRY_URL) {
      setLoaded(true)
      return
    }
    fetch(PANTRY_URL)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText)
        return r.json()
      })
      .then((data) => {
        if (Array.isArray(data.ids)) {
          setDeletedIds(new Set(data.ids))
        }
      })
      .catch(() => {
        // Basket may not exist yet — that's fine
      })
      .finally(() => setLoaded(true))
  }, [])

  // Keep index in bounds when cards list changes
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

    setTimeout(() => {
      const newDeleted = new Set(deletedIds)
      newDeleted.add(activeCard.id)
      setDeletedIds(newDeleted)
      setIsRipping(false)

      // Persist to Pantry
      if (PANTRY_URL) {
        fetch(PANTRY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [...newDeleted] }),
        }).catch(() => {})
      }

      // Adjust index: if we're at the end, go back one
      const newTotal = total - 1
      if (newTotal > 0 && index >= newTotal) {
        setIndex(newTotal - 1)
      }
    }, 500)
  }, [activeCard, deletedIds, index, total, isRipping])

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
