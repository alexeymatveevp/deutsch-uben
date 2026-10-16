import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE, type TranslationCard } from '../types'

/** How many cards are offered to choose from on each visit. */
const DECK_SIZE = 50
/** How many must be picked before a story can be generated. */
const PICK = 3

function sample<T>(arr: T[], n: number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

/** Cards saved with Russian on the front would confuse the prompt. */
function isGerman(text: string): boolean {
  return !/[Ѐ-ӿ]/.test(text)
}

type StoryResponse = { html: string; format: string }

/**
 * Mini story: pick three cards out of a random fifty and have the LLM
 * write a short absurd text that uses all three. The story is shown once
 * and never stored; the fifty are reshuffled on every visit.
 */
export default function Story() {
  const [cards, setCards] = useState<TranslationCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deckSeed, setDeckSeed] = useState(0)
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [story, setStory] = useState<StoryResponse | null>(null)
  const [storyCards, setStoryCards] = useState<TranslationCard[]>([])
  const [error, setError] = useState<string | null>(null)
  const storyRef = useRef<HTMLElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/api/cards`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json() as Promise<TranslationCard[]>
      })
      .then((data) => {
        if (!cancelled) setCards(data)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // A fresh random fifty on mount (each visit) and whenever reshuffled.
  const deck = useMemo(
    () => sample(cards.filter((c) => isGerman(c.source_text)), DECK_SIZE),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, deckSeed],
  )

  const reshuffle = () => {
    setDeckSeed((s) => s + 1)
    setSelected([])
    setStory(null)
    setError(null)
  }

  const toggle = (id: number) => {
    if (busy) return
    setSelected((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id)
      if (cur.length >= PICK) return cur
      return [...cur, id]
    })
  }

  const generate = useCallback(async () => {
    if (busy || selected.length !== PICK) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`${API_BASE}/api/story`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected }),
      })
      const data = (await r.json().catch(() => null)) as
        | (StoryResponse & { cards: TranslationCard[] })
        | { error?: string; message?: string }
        | null
      if (!r.ok || !data || !('html' in data)) {
        const msg = data && 'message' in data ? data.message || data.error : null
        throw new Error(msg || `${r.status} ${r.statusText}`)
      }
      setStory({ html: data.html, format: data.format })
      setStoryCards(data.cards)
      // Bring the story into view on phones, where it renders below the deck.
      requestAnimationFrame(() => storyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (err) {
      setError((err as Error).message || 'unknown error')
    } finally {
      setBusy(false)
    }
  }, [busy, selected])

  const chosen = selected
    .map((id) => deck.find((c) => c.id === id))
    .filter((c): c is TranslationCard => Boolean(c))

  return (
    <div className="page-scroll">
      <main className="app story-page">
        <div className="story-panel">
          <div className="story-head">
            <h2 className="learning-title">Мини-история</h2>
            <button type="button" className="quiz-chip" onClick={reshuffle} disabled={!loaded || busy}>
              Другие 50
            </button>
          </div>
          <p className="learning-empty">
            Выбери {PICK} карточки — и получи абсурдную историю, диалог или шутку с ними.
          </p>

          {!loaded && <p className="learning-empty">Loading…</p>}
          {loaded && loadError && <p className="learning-empty">Could not load: {loadError}</p>}

          {loaded && !loadError && (
            <>
              <div className="story-deck" role="group" aria-label="Карточки">
                {deck.map((c) => {
                  const isSel = selected.includes(c.id)
                  const full = !isSel && selected.length >= PICK
                  return (
                    <button
                      key={c.id}
                      type="button"
                      lang="de"
                      className={`story-card${isSel ? ' selected' : ''}${full ? ' muted' : ''}`}
                      onClick={() => toggle(c.id)}
                      aria-pressed={isSel}
                      title={c.target_text}
                      disabled={busy}
                    >
                      {isSel && <span className="story-card-num">{selected.indexOf(c.id) + 1}</span>}
                      {c.source_text}
                    </button>
                  )
                })}
              </div>

              <div className="story-actions">
                <div className="story-chosen">
                  {chosen.length === 0 ? (
                    <span className="learning-empty">Выбрано: 0 / {PICK}</span>
                  ) : (
                    chosen.map((c) => (
                      <span key={c.id} className="story-chosen-item">
                        <strong lang="de">{c.source_text}</strong>
                        <span> — {c.target_text}</span>
                      </span>
                    ))
                  )}
                </div>
                <button
                  type="button"
                  className={`quiz-btn primary${busy ? ' busy' : ''}`}
                  onClick={generate}
                  disabled={busy || selected.length !== PICK}
                >
                  {busy ? 'Сочиняем…' : story ? 'Ещё одну' : 'Создать историю'}
                </button>
              </div>

              {error && (
                <section className="examples-error" role="alert">
                  <span className="examples-error-title">Не удалось сочинить историю</span>
                  <span className="examples-error-detail">{error}</span>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {story && (
        <section ref={storyRef} className="examples story-output" lang="de">
          <div className="story-format">{story.format}</div>
          <div dangerouslySetInnerHTML={{ __html: story.html }} />
          <div className="story-cards-row">
            {storyCards.map((c) => (
              <Link key={c.id} to={`/?card=${c.id}`} className="story-card-link">
                {c.source_text} <span>— {c.target_text}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
