import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE, type TranslationCard } from '../types'
import { buildQuiz, type ClozeItem } from '../cloze'

const QUIZ_LENGTH = 10

type ScopeKey = 'all' | 'new' | 'learning' | 'ausdruck' | 'favorite'

const SCOPES: { key: ScopeKey; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'new', label: 'Новые 100' },
  { key: 'learning', label: 'В обучении' },
  { key: 'ausdruck', label: 'Выражения' },
  { key: 'favorite', label: 'Избранное' },
]

function filterByScope(cards: TranslationCard[], scope: ScopeKey): TranslationCard[] {
  switch (scope) {
    case 'new':
      return [...cards].sort((a, b) => b.id - a.id).slice(0, 100)
    case 'learning':
      return cards.filter((c) => c.learning_status !== null)
    case 'ausdruck':
    case 'favorite':
      return cards.filter((c) => c.category === scope)
    default:
      return cards
  }
}

type Phase = 'asking' | 'correct' | 'wrong'

/**
 * Cloze quiz: one example sentence per card with the target word blanked
 * out; tap the right word among four. Items come from the stored examples
 * and distractors from other cards, so a session is a fresh random pick
 * each time and costs nothing.
 */
export default function Quiz() {
  const [cards, setCards] = useState<TranslationCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scope, setScope] = useState<ScopeKey>('all')

  const [items, setItems] = useState<ClozeItem[]>([])
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('asking')
  const [chosen, setChosen] = useState<string | null>(null)
  const [hint, setHint] = useState(false)
  const [results, setResults] = useState<boolean[]>([])

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

  const pool = useMemo(() => filterByScope(cards, scope), [cards, scope])

  const startQuiz = useCallback((fromPool: TranslationCard[], reservoir: TranslationCard[]) => {
    setItems(buildQuiz(fromPool, QUIZ_LENGTH, reservoir))
    setIndex(0)
    setPhase('asking')
    setChosen(null)
    setHint(false)
    setResults([])
  }, [])

  // Start (or restart) when the cards arrive or the scope changes.
  useEffect(() => {
    if (!loaded || loadError) return
    startQuiz(pool, cards)
  }, [loaded, loadError, pool, cards, startQuiz])

  const item = items[index]
  const finished = loaded && items.length > 0 && index >= items.length

  const choose = useCallback(
    (option: string) => {
      if (!item || phase !== 'asking') return
      const ok = option === item.source
      setChosen(option)
      setPhase(ok ? 'correct' : 'wrong')
      setResults((r) => [...r, ok])
    },
    [item, phase],
  )

  const next = useCallback(() => {
    setIndex((i) => i + 1)
    setPhase('asking')
    setChosen(null)
    setHint(false)
  }, [])

  // Desktop convenience: 1–4 picks an option, Enter/Space moves on.
  useEffect(() => {
    if (!item || finished) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (phase === 'asking' && /^[1-4]$/.test(e.key)) {
        const opt = item.options[Number(e.key) - 1]
        if (opt) choose(opt)
      } else if (phase !== 'asking' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        next()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [item, finished, phase, choose, next])

  const score = results.filter(Boolean).length
  const resolved = phase !== 'asking'

  return (
    <main className="app quiz-page">
      <div className="quiz-panel">
        <h2 className="learning-title">Квиз</h2>
        <div className="quiz-scopes" role="radiogroup" aria-label="Набор карточек">
          {SCOPES.map((s) => {
            const n = filterByScope(cards, s.key).length
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={scope === s.key}
                className={`quiz-chip${scope === s.key ? ' active' : ''}`}
                onClick={() => setScope(s.key)}
                disabled={!loaded || n === 0}
              >
                {s.label}
                {loaded ? ` · ${n}` : ''}
              </button>
            )
          })}
        </div>

        {!loaded && <p className="learning-empty">Loading…</p>}
        {loaded && loadError && <p className="learning-empty">Could not load: {loadError}</p>}
        {loaded && !loadError && items.length === 0 && (
          <p className="learning-empty">В этом наборе нет карточек с примерами.</p>
        )}

        {item && !finished && (
          <>
            <div className="quiz-progress">
              <span>
                {index + 1} / {items.length}
              </span>
              <span>
                верно: {score} / {results.length}
              </span>
            </div>

            <p className="quiz-sentence" lang="de">
              {item.segments.map((seg, i) =>
                seg.blank ? (
                  resolved ? (
                    <strong
                      key={i}
                      className={`cloze-answer ${phase === 'correct' ? 'correct' : 'wrong'}`}
                    >
                      {seg.text}
                    </strong>
                  ) : (
                    <span
                      key={i}
                      className="cloze-gap"
                      style={{ minWidth: `${Math.max(3, seg.text.length)}ch` }}
                      aria-label="пропуск"
                    >
                      {'_'.repeat(Math.max(3, seg.text.length))}
                    </span>
                  )
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </p>

            <div className="quiz-hint">
              {resolved ? (
                <span className="quiz-result">
                  {phase === 'correct' ? (
                    <span className="correct">Верно!</span>
                  ) : (
                    <span className="wrong">Неверно.</span>
                  )}
                  <Link to={`/?card=${item.cardId}`}>
                    {item.source} — {item.target}
                  </Link>
                </span>
              ) : hint ? (
                <span>{item.target}</span>
              ) : (
                <button type="button" onClick={() => setHint(true)}>
                  Подсказка
                </button>
              )}
            </div>

            <div className="quiz-options" role="group" aria-label="Варианты ответа">
              {item.options.map((opt, i) => {
                const isRight = opt === item.source
                const isChosen = opt === chosen
                const state = !resolved ? '' : isRight ? ' right' : isChosen ? ' wrong' : ' dim'
                return (
                  <button
                    key={opt}
                    type="button"
                    lang="de"
                    className={`quiz-option${state}`}
                    onClick={() => choose(opt)}
                    disabled={resolved}
                    aria-pressed={isChosen}
                  >
                    <span className="quiz-option-key" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>{opt}</span>
                  </button>
                )
              })}
            </div>

            <div className="quiz-form">
              {resolved && (
                <button type="button" className="quiz-btn primary" onClick={next} autoFocus>
                  {index + 1 < items.length ? 'Дальше' : 'Результат'}
                </button>
              )}
            </div>
          </>
        )}

        {finished && (
          <>
            <div className="quiz-score">
              {score} / {items.length}
            </div>
            {score === items.length ? (
              <p className="learning-empty">Все верно. Так держать!</p>
            ) : (
              <>
                <p className="learning-empty">Стоит повторить:</p>
                <ul className="quiz-missed">
                  {items
                    .filter((_, i) => !results[i])
                    .map((it) => (
                      <li key={it.cardId}>
                        <Link to={`/?card=${it.cardId}`}>
                          <span>{it.source}</span>
                          <span>{it.target}</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </>
            )}
            <div className="quiz-form">
              <button
                type="button"
                className="quiz-btn primary"
                onClick={() => startQuiz(pool, cards)}
                autoFocus
              >
                Ещё раз
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
