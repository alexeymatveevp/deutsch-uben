#!/usr/bin/env node

/**
 * Enriches cards in the SQLite database with LLM-generated German usage
 * examples. Reads and writes the `cards` table directly.
 *
 * Usage:
 *   tsx scripts/enrich-data.mjs                          # no-op (nothing to do without flags)
 *   tsx scripts/enrich-data.mjs --limit 5                # enrich 5 cards that have no examples yet
 *   tsx scripts/enrich-data.mjs --ids 1109,1108          # enrich specific IDs
 *   tsx scripts/enrich-data.mjs --limit 2 --model gpt-4o-mini
 *   tsx scripts/enrich-data.mjs --dry-run                # print prompt for the first candidate, no API call
 *
 * Options:
 *   --limit N        Enrich the first N cards without examples_html
 *   --ids 1109,1108  Enrich specific cards by ID
 *   --model NAME     OpenAI model to use (default: gpt-4o)
 *   --dry-run        Print the prompt for the first card and exit
 */

import 'dotenv/config'
import OpenAI from 'openai'
import { marked } from 'marked'
import {
  listCardsWithoutExamples,
  updateExamplesHtml,
  closeDb,
  getDbPath,
} from '../server/db.ts'

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { limit: 0, ids: /** @type {number[]} */ ([]), model: 'gpt-4o', dryRun: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10)
    else if (args[i] === '--ids' && args[i + 1]) opts.ids = args[++i].split(',').map(Number)
    else if (args[i] === '--model' && args[i + 1]) opts.model = args[++i]
    else if (args[i] === '--dry-run') opts.dryRun = true
  }
  return opts
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
function buildPrompt(sourceText, targetText) {
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

Antworte nur auf Deutsch. Benutze Markdown-Formatierung.`
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs()
  const wantsEnrich = opts.ids.length > 0 || opts.limit > 0 || opts.dryRun

  if (!wantsEnrich) {
    console.error('No --limit, --ids, or --dry-run specified — nothing to do.')
    return
  }

  console.error(`DB: ${getDbPath()}`)

  const toProcess =
    opts.ids.length > 0
      ? listCardsWithoutExamples({ ids: opts.ids })
      : listCardsWithoutExamples({ limit: opts.limit > 0 ? opts.limit : undefined })

  if (toProcess.length === 0) {
    console.error(
      opts.ids.length > 0
        ? `No cards found with IDs: ${opts.ids.join(', ')}`
        : 'No cards without examples_html found.',
    )
    return
  }

  console.error(`Will enrich ${toProcess.length} cards`)

  if (opts.dryRun) {
    const item = toProcess[0]
    console.log('=== DRY RUN — Prompt for ID', item.id, '===')
    console.log(buildPrompt(item.source_text, item.target_text))
    return
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: Set OPENAI_API_KEY environment variable.')
    process.exit(1)
  }

  const openai = new OpenAI()

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i]
    console.error(`[${i + 1}/${toProcess.length}] ID ${item.id}: "${item.source_text}"…`)

    try {
      const response = await openai.chat.completions.create({
        model: opts.model,
        messages: [{ role: 'user', content: buildPrompt(item.source_text, item.target_text) }],
        temperature: 0.7,
        max_tokens: 1000,
      })

      if (response.usage) {
        console.error(`  tokens: ${response.usage.prompt_tokens}+${response.usage.completion_tokens}`)
      }
      const markdown = response.choices[0].message.content
      const html = await marked.parse(markdown)

      updateExamplesHtml(item.id, html)
      console.error(`  ✓ saved`)
    } catch (err) {
      console.error(`  ✗ error: ${err.message}`)
    }
  }

  console.error('\nDone.')
}

main()
  .catch((err) => {
    console.error('Fatal:', err)
    process.exitCode = 1
  })
  .finally(() => {
    closeDb()
  })
