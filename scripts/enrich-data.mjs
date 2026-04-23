#!/usr/bin/env node

/**
 * Enriches cards in the SQLite database with LLM-generated German usage
 * examples. Thin CLI wrapper — the actual enrichment logic lives in
 * server/enrich.ts so it can also be invoked from the HTTP server.
 *
 * CLI usage:
 *   tsx scripts/enrich-data.mjs                          # no-op (nothing to do without flags)
 *   tsx scripts/enrich-data.mjs --limit 5                # enrich 5 cards that have no examples yet
 *   tsx scripts/enrich-data.mjs --ids 1109,1108          # enrich specific IDs
 *   tsx scripts/enrich-data.mjs --limit 2 --model gpt-4o-mini
 *   tsx scripts/enrich-data.mjs --dry-run                # print prompt for the first candidate, no API call
 *
 * Programmatic usage (from scrape-public-collection-by-link.mjs):
 *   import { enrichAllMissing } from './enrich-data.mjs'
 *   await enrichAllMissing('gpt-4o')
 *
 * Options:
 *   --limit N        Enrich the first N cards without examples_html
 *   --ids 1109,1108  Enrich specific cards by ID
 *   --model NAME     OpenAI model to use (default: gpt-4o)
 *   --dry-run        Print the prompt for the first card and exit
 */

import 'dotenv/config'
import { fileURLToPath } from 'url'
import { listCardsWithoutExamples, closeDb, getDbPath } from '../server/db.ts'
import { buildPrompt, enrichItems, enrichCardsByIds, enrichAllMissing } from '../server/enrich.ts'

// Re-export for existing importers (e.g. scrape-public-collection-by-link.mjs).
export { enrichCardsByIds, enrichAllMissing, buildPrompt }

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

// ─── CLI entry ────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs()
  const wantsEnrich = opts.ids.length > 0 || opts.limit > 0 || opts.dryRun

  if (!wantsEnrich) {
    console.error('No --limit, --ids, or --dry-run specified — nothing to do.')
    return
  }

  console.error(`DB: ${getDbPath()}`)

  const candidates =
    opts.ids.length > 0
      ? listCardsWithoutExamples({ ids: opts.ids })
      : listCardsWithoutExamples({ limit: opts.limit > 0 ? opts.limit : undefined })

  if (candidates.length === 0) {
    console.error(
      opts.ids.length > 0
        ? `No cards found with IDs: ${opts.ids.join(', ')}`
        : 'No cards without examples_html found.',
    )
    return
  }

  console.error(`Will enrich ${candidates.length} cards`)

  if (opts.dryRun) {
    const item = candidates[0]
    console.log('=== DRY RUN — Prompt for ID', item.id, '===')
    console.log(buildPrompt(item.source_text, item.target_text))
    return
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: Set OPENAI_API_KEY environment variable.')
    process.exit(1)
  }

  const { processed, failed } = await enrichItems(candidates, opts.model)
  console.error(`\nDone. processed=${processed}, failed=${failed}`)
}

// Run main() only when invoked directly, not when imported.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((err) => {
      console.error('Fatal:', err)
      process.exitCode = 1
    })
    .finally(() => {
      closeDb()
    })
}
