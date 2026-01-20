import { useEffect, useMemo, useState } from 'react'
import data from './data/yandex-collections.json'

type TranslationCard = {
  source_text: string
  target_text: string
}

const STORAGE_KEY = 'deutsch-uben:last-card-index'

function clampIndex(index: number, length: number) {
  if (length <= 0) {
    return 0
  }
  const normalized = index % length
  return normalized < 0 ? normalized + length : normalized
}

function App() {
  const cards = useMemo(
    () => data as TranslationCard[],
    []
  )
  const [index, setIndex] = useState(() => {
    if (cards.length === 0) {
      return 0
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? Number(raw) : NaN
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < cards.length) {
      return parsed
    }
    return Math.floor(Math.random() * cards.length)
  })
  const [isFlipped, setIsFlipped] = useState(false)
  const [disableFlipTransition, setDisableFlipTransition] = useState(false)

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
    return () => cancelAnimationFrame(frame)
  }, [index])

  const activeCard = cards[index]
  const total = cards.length
  const displayIndex = total > 0 ? index + 1 : 0

  const goPrev = () => {
    if (total === 0) {
      return
    }
    setIndex((current) => clampIndex(current - 1, total))
  }

  const goNext = () => {
    if (total === 0) {
      return
    }
    setIndex((current) => clampIndex(current + 1, total))
  }

  const goRandom = () => {
    if (total === 0) {
      return
    }
    const next = Math.floor(Math.random() * total)
    setIndex(next)
  }

  if (total === 0) {
    return (
      <main className="app app-empty">
        <p>No cards available.</p>
      </main>
    )
  }

  return (
    <main className="app">
      <div className="index-badge">
        {displayIndex} / {total}
      </div>
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
  )
}

export default App
