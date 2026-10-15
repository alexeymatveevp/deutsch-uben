import OpenAI from 'openai'
import { marked } from 'marked'
import {
  getCardById,
  listCardsWithoutExamples,
  updateExamplesHtml,
  type TranslationCard,
} from './db.js'

export type EnrichResult = {
  processed: number
  failed: number
  skipped: boolean
  /** Provider-reported reason for the last failure, for surfacing in the UI. */
  error?: string
}

type Provider = {
  client: OpenAI
  model: string
  name: string
  /**
   * OpenRouter-only: models to try, in order, if `model` fails (dead slug,
   * rate limit, provider outage). Sent as the `models` routing param.
   */
  fallbackModels?: string[]
}

/**
 * Default OpenRouter model. Claude Haiku 5.5 writes natural, idiomatic
 * German, handles the nuance-between-synonyms part of the prompt well, and
 * at ~$0.10/M input + $0.50/M output a card costs well under $0.001.
 * Paid slugs don't get retired the way ":free" ones did (twice).
 */
export const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-haiku-5.5'

/**
 * Tried in order by OpenRouter when the primary model errors. Both are
 * cheap, strong at German, and from different vendors than the primary so
 * a single-provider outage doesn't take enrichment down.
 */
export const OPENROUTER_FALLBACK_MODELS = [
  'google/gemini-2.5-flash',
  'openai/gpt-5-mini',
]

/**
 * Pick the LLM provider from the environment. OpenRouter wins when
 * OPENROUTER_API_KEY is set; otherwise falls back to OpenAI. Returns
 * null when neither key is configured.
 *
 * An explicit `model` argument overrides the provider default, so model
 * IDs must match the active provider (e.g. 'anthropic/claude-haiku-5.5' on
 * OpenRouter vs 'gpt-4o' on OpenAI). Fallback routing only applies when
 * no explicit model was requested.
 */
export function getProvider(model?: string): Provider | null {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      name: 'openrouter',
      client: new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      }),
      model: model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
      fallbackModels: model ? undefined : OPENROUTER_FALLBACK_MODELS,
    }
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: 'openai', client: new OpenAI(), model: model ?? 'gpt-4o' }
  }
  return null
}

/**
 * Extra request params the OpenAI SDK doesn't type but OpenRouter honours.
 * `models` makes OpenRouter fall back to the next slug when the primary
 * one is unavailable (404 retired, 429 upstream, 5xx) instead of failing.
 */
function routingParams(provider: Provider): Record<string, unknown> {
  if (!provider.fallbackModels?.length) return {}
  return { models: [provider.model, ...provider.fallbackModels] }
}

/**
 * Turn a provider exception into something worth showing a user.
 *
 * OpenRouter often answers with a generic top-level message ("Provider
 * returned error") and puts the actionable text in error.metadata.raw —
 * e.g. "…is temporarily rate-limited upstream. Please retry shortly".
 * Prefer the specific one, and keep the HTTP status as a prefix since it
 * distinguishes a retryable 429 from a dead model slug (404).
 */
export function describeProviderError(err: unknown): string {
  const e = err as {
    status?: number
    message?: string
    error?: { message?: string; metadata?: { raw?: string } }
  }
  const generic = e?.error?.message ?? ''
  const raw = e?.error?.metadata?.raw ?? ''
  // metadata.raw wins when it says more than the top-level message does.
  let detail = raw && !generic.includes(raw) ? raw : generic
  if (!detail) detail = e?.message ?? String(err)
  detail = detail.trim().replace(/\s+/g, ' ')
  if (detail.length > 300) detail = `${detail.slice(0, 297)}…`
  const status = typeof e?.status === 'number' ? `${e.status} ` : ''
  return detail.startsWith(status.trim()) ? detail : `${status}${detail}`
}

export function buildPrompt(sourceText: string, targetText: string): string {
  return `Du bist ein hilfreicher Deutsch-Tutor. Der Benutzer lernt das folgende deutsche Wort oder den folgenden Ausdruck:

**${sourceText}**

(Übersetzung: ${targetText})

Bitte erstelle eine kurze, nützliche Lernkarte auf Deutsch. Verwende folgendes Format:

1. **Wenn es ein Nomen ist:** Gib den Artikel, den Plural und den Genitiv an (z.B. *der Tisch, die Tische, des Tisches*).
2. **Wenn es ein Verb ist:** Gib die wichtigsten Formen an: Präsens (3. Person Singular), Präteritum, Perfekt (z.B. *er gibt, er gab, er hat gegeben*).
3. **Wenn es ein Adjektiv oder Adverb ist:** Gib Komparativ und Superlativ an, falls sinnvoll.
4. Dann gib **3–5 natürliche Beispielsätze** auf Deutsch. Die Beispiele sollen so klingen, als würden sie in echten Gesprächen, Büchern oder Filmen vorkommen. Markiere das Zielwort/den Zielausdruck **fett**.
5. **Synonyme / alternative Ausdrücke:**
   - **Wenn es ein einzelnes Wort ist:** Gib 2–4 Synonyme oder bedeutungsnahe Wörter an.
   - **Wenn es ein Ausdruck oder ein Satz ist:** Gib 2–3 andere Möglichkeiten, dasselbe zu sagen. Falls zutreffend, kennzeichne formellere Varianten mit *(formell)* und umgangssprachlichere mit *(umgangssprachlich)*.
6. **Unterschiede zwischen den Synonymen:** Wähle mindestens 1–2 der oben genannten Synonyme und erkläre prägnant, worin sie sich vom Zielwort/Zielausdruck unterscheiden — z.B. in Bedeutungsnuance, Stilebene, Verwendungssituation, Konnotation oder Häufigkeit. Wenn hilfreich, gib einen kurzen Beispielsatz, der den Unterschied verdeutlicht. Ohne diese Erklärung sind Synonyme nur Wörter — der Lernende soll verstehen, *wann* man welches benutzt.

Antworte nur auf Deutsch. Benutze Markdown-Formatierung.`
}

export async function enrichItems(
  items: TranslationCard[],
  model?: string,
): Promise<EnrichResult> {
  if (items.length === 0) return { processed: 0, failed: 0, skipped: false }
  const provider = getProvider(model)
  if (!provider) {
    console.error('Neither OPENROUTER_API_KEY nor OPENAI_API_KEY set — skipping enrichment.')
    return { processed: 0, failed: 0, skipped: true }
  }
  console.error(`Using ${provider.name} (${provider.model})`)

  let processed = 0
  let failed = 0
  let error: string | undefined

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    console.error(`[enrich ${i + 1}/${items.length}] ID ${item.id}: "${item.source_text}"…`)

    try {
      const response = await provider.client.chat.completions.create({
        model: provider.model,
        messages: [{ role: 'user', content: buildPrompt(item.source_text, item.target_text) }],
        temperature: 0.7,
        // Reasoning models bill their hidden chain-of-thought against
        // max_tokens, so a tight budget gets spent thinking and the card
        // comes back truncated or empty (finish_reason 'length'). Leave
        // enough headroom for the reasoning plus the full card.
        max_tokens: 2500,
        ...routingParams(provider),
      })

      if (response.usage) {
        console.error(
          `  tokens: ${response.usage.prompt_tokens}+${response.usage.completion_tokens}` +
            (response.model && response.model !== provider.model
              ? ` (served by fallback ${response.model})`
              : ''),
        )
      }
      const markdown = response.choices[0]?.message?.content?.trim() ?? ''
      if (!markdown) {
        // A provider can answer 200 with empty content (filtered, truncated,
        // or a reasoning-only reply). Saving that leaves a blank card.
        throw new Error('provider returned an empty response')
      }
      const html = await marked.parse(markdown)

      await updateExamplesHtml(item.id, html)
      console.error('  ✓ saved')
      processed++
    } catch (err) {
      const detail = describeProviderError(err)
      error = `${provider.name} (${provider.model}): ${detail}`
      console.error(`  ✗ error: ${detail}`)
      failed++
    }
  }

  return { processed, failed, skipped: false, error }
}

export async function enrichCardsByIds(
  ids: number[],
  model?: string,
): Promise<EnrichResult> {
  if (!ids || ids.length === 0) return { processed: 0, failed: 0, skipped: false }
  const items = await listCardsWithoutExamples({ ids })
  if (items.length === 0) {
    console.error('No cards to enrich (already enriched or deleted).')
    return { processed: 0, failed: 0, skipped: false, error: 'card not found or deleted' }
  }
  return enrichItems(items, model)
}

export async function enrichAllMissing(model?: string): Promise<EnrichResult> {
  const items = await listCardsWithoutExamples()
  if (items.length === 0) {
    console.error('No cards missing examples_html.')
    return { processed: 0, failed: 0, skipped: false }
  }
  console.error(`Found ${items.length} card(s) missing examples_html.`)
  return enrichItems(items, model)
}

/**
 * Regenerate (or generate) examples for a single card and return the
 * fresh row. Returns null if the card is missing/deleted or enrichment
 * failed. `skipped` means no API key is configured.
 */
export async function enrichCardById(
  id: number,
  model?: string,
): Promise<{ card: TranslationCard | null; result: EnrichResult }> {
  const result = await enrichCardsByIds([id], model)
  const card = result.processed > 0 ? await getCardById(id) : null
  return { card, result }
}

/**
 * Translate a German word/phrase to Russian via the configured LLM
 * provider. Returns null if no API key is configured or the API returns
 * no usable text.
 */
export async function translateToRussian(
  germanText: string,
  model?: string,
): Promise<string | null> {
  const provider = getProvider(model)
  if (!provider) return null
  const response = await provider.client.chat.completions.create({
    model: provider.model,
    messages: [
      {
        role: 'user',
        content: `Translate the following German word or phrase into Russian. Respond with ONLY the translation, no quotes, no explanation, no extra punctuation.\n\n${germanText}`,
      },
    ],
    temperature: 0,
    // Also needs reasoning headroom — see the note in enrichItems. A
    // translation is short, but the thinking that precedes it is not.
    max_tokens: 600,
    ...routingParams(provider),
  })
  const text = response.choices[0]?.message?.content?.trim() ?? ''
  return text || null
}
