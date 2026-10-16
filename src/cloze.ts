import type { TranslationCard } from './types'

/**
 * Cloze (fill-the-gap) items are derived on the fly from the enrichment
 * text already stored on each card: the example sentences there have the
 * target word or expression in bold. Every <li> with a bold span and a
 * sentence-like shape becomes one item; the bold spans become the gaps.
 * Nothing is generated or stored, so a new quiz is a fresh random pick
 * every time.
 */

export type ClozeSegment = { text: string; blank: boolean }

export type ClozeItem = {
  cardId: number
  /** Card front, e.g. "in Anspruch nehmen". */
  source: string
  /** Card back (Russian), used as the hint. */
  target: string
  segments: ClozeSegment[]
  /** Accepted answers, un-normalised. */
  answers: string[]
  /** Multiple-choice options (base forms), shuffled; `source` is the right one. */
  options: string[]
}

const MIN_SENTENCE_LEN = 20
const SENTENCE_END = /[.!?…]["»“”']?$/

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Case-, umlaut- and punctuation-insensitive form used for comparing answers. */
export function normalize(s: string): string {
  return squash(s)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[.,;:!?…"„“”'’«»()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isCorrect(input: string, item: ClozeItem): boolean {
  const given = normalize(input)
  if (!given) return false
  return item.answers.some((a) => normalize(a) === given)
}

function segmentsOf(li: Element): ClozeSegment[] | null {
  const segments: ClozeSegment[] = []
  let blanks = 0
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? ''
      if (t) segments.push({ text: t, blank: false })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    if (el.tagName === 'STRONG' || el.tagName === 'B') {
      const t = squash(el.textContent ?? '')
      if (!t) return
      segments.push({ text: t, blank: true })
      blanks++
      return
    }
    // Nested lists belong to a different example; don't merge them in.
    if (el.tagName === 'UL' || el.tagName === 'OL') return
    el.childNodes.forEach(walk)
  }
  li.childNodes.forEach(walk)
  if (blanks === 0) return null

  // Merge adjacent plain-text segments and tidy whitespace.
  const merged: ClozeSegment[] = []
  for (const s of segments) {
    const prev = merged[merged.length - 1]
    if (prev && !prev.blank && !s.blank) prev.text += s.text
    else merged.push({ ...s })
  }
  for (const s of merged) if (!s.blank) s.text = s.text.replace(/\s+/g, ' ')
  if (merged.length && !merged[0].blank) merged[0].text = merged[0].text.replace(/^\s+/, '')
  const last = merged[merged.length - 1]
  if (last && !last.blank) last.text = last.text.replace(/\s+$/, '')
  return merged
}

const HEADING = 'h1, h2, h3, h4, h5, h6'
const EXAMPLES_HEADING = /beispiel/i

/**
 * Text of the nearest heading above `el` in document order. The enrichment
 * is sectioned ("Beispielsätze", "Synonyme", "Unterschiede"), and only the
 * examples section holds real sentences; the others bold the word as a
 * label ("**Vorliebe**: klingt natürlich …"). Headings are either real
 * <hN> elements or a paragraph that is entirely bold.
 */
function sectionOf(el: Element, headings: Element[]): string | null {
  let best: Element | null = null
  for (const h of headings) {
    const rel = h.compareDocumentPosition(el)
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) best = h
    else break
  }
  return best ? squash(best.textContent ?? '') : null
}

function collectHeadings(doc: Document): Element[] {
  const out: Element[] = []
  doc.body.querySelectorAll(`${HEADING}, p`).forEach((el) => {
    if (el.tagName !== 'P') {
      out.push(el)
      return
    }
    // "<p><strong>2. Beispielsätze</strong></p>" style pseudo-headings.
    const strong = el.querySelector('strong, b')
    if (strong && squash(strong.textContent ?? '') === squash(el.textContent ?? '')) out.push(el)
  })
  return out
}

/** All cloze items a card can offer, in document order. */
export function extractCloze(card: TranslationCard): ClozeItem[] {
  if (!card.examples_html) return []
  const doc = new DOMParser().parseFromString(card.examples_html, 'text/html')
  const items: ClozeItem[] = []
  const source = card.source_text.replace(/\.\s*$/, '').trim()
  const headings = collectHeadings(doc)
  const hasExamplesSection = headings.some((h) => EXAMPLES_HEADING.test(h.textContent ?? ''))

  doc.querySelectorAll('li').forEach((li) => {
    // When the card is sectioned, only the examples section counts.
    if (hasExamplesSection) {
      const section = sectionOf(li, headings)
      if (!section || !EXAMPLES_HEADING.test(section)) return
    }
    const segments = segmentsOf(li)
    if (!segments) return
    const blanks = segments.filter((s) => s.blank).map((s) => s.text)
    // "<strong>Präteritum:</strong> er nahm" is a form table row, not a sentence.
    if (blanks.some((b) => /:$/.test(b))) return
    // "<strong>Vorliebe</strong>: klingt natürlich …" is a glossary entry.
    if (segments[0]?.blank && /^\s*[:–—-]/.test(segments[1]?.text ?? '')) return
    const text = squash(segments.map((s) => s.text).join(''))
    if (text.length < MIN_SENTENCE_LEN || !SENTENCE_END.test(text)) return
    // Explanations that embed an example ("… Beispiel: „…“") are not sentences.
    if (/Beispiel\s*:/.test(text)) return
    // A sentence that is bold from start to end has no context to go on.
    if (blanks.join(' ').length >= text.length - 2) return

    const answers = new Set<string>()
    for (const b of blanks) answers.add(b)
    if (blanks.length > 1) answers.add(blanks.join(' '))
    if (source) answers.add(source)
    items.push({
      cardId: card.id,
      source,
      target: card.target_text,
      segments,
      answers: [...answers],
      options: [],
    })
  })
  return items
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Base form shown as an option: the card front without a trailing full stop. */
function baseForm(card: TranslationCard): string {
  return card.source_text.replace(/\.\s*$/, '').trim()
}

/**
 * A few cards were saved the wrong way round (Russian on the front). They
 * would give the answer away as the only Cyrillic option, so they are
 * neither quizzed nor used as distractors.
 */
function isGerman(text: string): boolean {
  return !/[\u0400-\u04FF]/.test(text)
}

/**
 * Rough word-class bucket from the surface form alone, used to pick
 * distractors that look like the answer: a noun among nouns, a phrase
 * among phrases. Wrong guesses here only make a distractor less sneaky.
 */
type Shape = 'phrase' | 'noun' | 'verb' | 'other'
function shapeOf(text: string): Shape {
  if (/\s/.test(text)) return 'phrase'
  if (/^[A-ZÄÖÜ]/.test(text)) return 'noun'
  if (/(en|ern|eln)$/.test(text)) return 'verb'
  return 'other'
}

/**
 * Three distractors for `item` drawn from `reservoir`: same shape and a
 * similar length where possible, never an accepted answer, no duplicates
 * after normalisation. Falls back to any other card when the strict pick
 * runs dry (small scopes like Избранное).
 */
export function buildOptions(
  item: ClozeItem,
  reservoir: TranslationCard[],
  count = 4,
): string[] {
  const taken = new Set(item.answers.map(normalize))
  taken.add(normalize(item.source))
  const shape = shapeOf(item.source)
  const len = item.source.length

  const candidates = shuffle(reservoir)
    .map(baseForm)
    .filter((t) => t && isGerman(t) && !taken.has(normalize(t)))
  const similar = candidates.filter(
    (t) => shapeOf(t) === shape && Math.abs(t.length - len) <= Math.max(4, len * 0.5),
  )
  const sameShape = candidates.filter((t) => shapeOf(t) === shape)

  const picked: string[] = []
  for (const list of [similar, sameShape, candidates]) {
    for (const t of list) {
      if (picked.length >= count - 1) break
      const n = normalize(t)
      if (taken.has(n)) continue
      taken.add(n)
      picked.push(t)
    }
    if (picked.length >= count - 1) break
  }
  return shuffle([item.source, ...picked])
}

/**
 * Pick `count` cards at random from `cards`, one random sentence each,
 * with multiple-choice options drawn from `reservoir` (defaults to the
 * same cards; pass the full collection so small scopes still get four).
 */
export function buildQuiz(
  cards: TranslationCard[],
  count: number,
  reservoir: TranslationCard[] = cards,
): ClozeItem[] {
  const out: ClozeItem[] = []
  for (const card of shuffle(cards)) {
    if (out.length >= count) break
    if (!isGerman(card.source_text)) continue
    const items = extractCloze(card)
    if (items.length === 0) continue
    const item = items[Math.floor(Math.random() * items.length)]
    item.options = buildOptions(item, reservoir)
    out.push(item)
  }
  return out
}
