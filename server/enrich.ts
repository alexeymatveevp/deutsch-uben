import OpenAI from 'openai'
import { marked } from 'marked'
import {
  getCardById,
  listCardsWithoutExamples,
  updateExamplesHtml,
  type TranslationCard,
} from './db.js'

export type EnrichResult = { processed: number; failed: number; skipped: boolean }

type Provider = { client: OpenAI; model: string; name: string }

/**
 * Pick the LLM provider from the environment. OpenRouter wins when
 * OPENROUTER_API_KEY is set; otherwise falls back to OpenAI. Returns
 * null when neither key is configured.
 *
 * An explicit `model` argument overrides the provider default, so model
 * IDs must match the active provider (e.g. 'openrouter/free' vs 'gpt-4o').
 */
export function getProvider(model?: string): Provider | null {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      name: 'openrouter',
      client: new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
      }),
      model: model ?? process.env.OPENROUTER_MODEL ?? 'openrouter/free',
    }
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: 'openai', client: new OpenAI(), model: model ?? 'gpt-4o' }
  }
  return null
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

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    console.error(`[enrich ${i + 1}/${items.length}] ID ${item.id}: "${item.source_text}"…`)

    try {
      const response = await provider.client.chat.completions.create({
        model: provider.model,
        messages: [{ role: 'user', content: buildPrompt(item.source_text, item.target_text) }],
        temperature: 0.7,
        max_tokens: 1000,
      })

      if (response.usage) {
        console.error(
          `  tokens: ${response.usage.prompt_tokens}+${response.usage.completion_tokens}`,
        )
      }
      const markdown = response.choices[0].message.content ?? ''
      const html = await marked.parse(markdown)

      await updateExamplesHtml(item.id, html)
      console.error('  ✓ saved')
      processed++
    } catch (err) {
      console.error(`  ✗ error: ${(err as Error).message}`)
      failed++
    }
  }

  return { processed, failed, skipped: false }
}

export async function enrichCardsByIds(
  ids: number[],
  model?: string,
): Promise<EnrichResult> {
  if (!ids || ids.length === 0) return { processed: 0, failed: 0, skipped: false }
  const items = await listCardsWithoutExamples({ ids })
  if (items.length === 0) {
    console.error('No cards to enrich (already enriched or deleted).')
    return { processed: 0, failed: 0, skipped: false }
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
    max_tokens: 100,
  })
  const text = response.choices[0]?.message?.content?.trim() ?? ''
  return text || null
}
