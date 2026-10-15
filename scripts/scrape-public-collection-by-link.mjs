#!/usr/bin/env node

/**
 * Syncs translation pairs from one or more public Yandex Translate
 * collections into the PostgreSQL database at DATABASE_URL.
 *
 * Usage:
 *   tsx scripts/scrape-public-collection-by-link.mjs                  # sync the URLS list below
 *   tsx scripts/scrape-public-collection-by-link.mjs <URL or id>      # sync just that collection
 *
 * Scheduling (systemd timer on the VPS): runs hourly at :30 past the hour
 * (deutsch-uben-scrape.timer). The :30 offset keeps it from racing the
 * 08:00 morning learning job. Also triggered on demand from the UI
 * ("Обновить карточки") via server/scrape-job.ts.
 *
 * How it works:
 * - Each collection is read from the JSON endpoint the share page itself
 *   uses (…/props/api/collections/<id>?srv=tr-text). It returns every
 *   record with its creation timestamp, needs no cookies and no browser,
 *   and answers in well under a second — unlike the rendered page, which
 *   is served from a cache that was observed to lag a day behind and to
 *   intermittently render zero records.
 * - A cache-busting `_=<now>` parameter plus no-cache headers keep CDN
 *   copies out of the way.
 * - Records from all collections are merged, de-duplicated by text (latest
 *   timestamp wins), sorted by creation time, and handed to
 *   syncScrapedRecords, which assigns ids in that order so the most
 *   recently added card ends up first in the UI. A text that was removed
 *   and re-added to a collection gets dropped and inserted afresh, i.e.
 *   it surfaces at the top again.
 * - New and re-added cards start learning; then every card still missing
 *   examples is enriched.
 *
 * The last log line is `SUMMARY <json>`; server/scrape-job.ts parses it
 * to show per-collection counts in the UI.
 */

import 'dotenv/config'
import {
  closeDb,
  ensureScrapeSchema,
  getDbUrl,
  startLearning,
  syncScrapedRecords,
} from '../server/db.ts'
import { enrichAllMissing } from './enrich-data.mjs'

/**
 * Starting countdown for a freshly-scraped card. Always 1 so the very next
 * 08:00 morning job decrements it to 0 and notifies — the user wants the
 * reminder at the next morning pass, even if the card was scraped only
 * hours earlier the same day.
 */
const STARTING_LEARNING_DAYS = 1

// ─── Collections to sync on scheduled runs ────────────────────────────────────
// Share links as copied from the Yandex Translate app; the collection id is
// taken from the `collection_id` query parameter.
const URLS = [
  'https://translate.yandex.ru/subscribe?collection_id=69713918c21400f565353437&utm_source=collection_share_ios',
  'https://translate.yandex.ru/subscribe?collection_id=69cb965c5f298af7bab72d7d&utm_source=new_collection_share_desktop',
]

const API_BASE = 'https://translate.yandex.ru/props/api/collections'
const FETCH_TIMEOUT_MS = 30000
const FETCH_ATTEMPTS = 3

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  if (args[0] === '--help' || args[0] === '-h') {
    console.error(
      'Usage: tsx scripts/scrape-public-collection-by-link.mjs [<URL or collection id>]\n' +
        '  With no argument, syncs the hardcoded URLS list.\n' +
        '  With an argument, syncs just that collection.',
    )
    process.exit(0)
  }
  return { override: args[0] ?? null }
}

/** Accepts a share URL or a bare 24-hex collection id. */
function collectionIdFrom(urlOrId) {
  if (/^[0-9a-f]{24}$/i.test(urlOrId)) return urlOrId
  const id = new URL(urlOrId).searchParams.get('collection_id')
  if (!id) throw new Error(`no collection_id in ${urlOrId}`)
  return id
}

// ─── Fetch one collection ─────────────────────────────────────────────────────
/**
 * @returns {Promise<{ name: string, count: number, records: { source_text: string, target_text: string, created_at: number }[] }>}
 */
async function fetchCollection(id) {
  let lastErr
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    const url = `${API_BASE}/${id}?srv=tr-text&_=${Date.now()}`
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const json = await res.json()
      const col = json?.collection
      if (!col || !Array.isArray(col.records)) {
        throw new Error(`unexpected response shape: ${JSON.stringify(json).slice(0, 200)}`)
      }
      const records = []
      for (const r of col.records) {
        const source_text = String(r.text ?? '').trim()
        const target_text = String(r.translation ?? '').trim()
        const created_at = Number(r.creationTimestamp)
        if (!source_text || !target_text || !Number.isFinite(created_at)) continue
        records.push({ source_text, target_text, created_at })
      }
      // The API reports the collection's own count; a mismatch would mean
      // a truncated/paginated answer, which we have not seen but should
      // not silently accept either.
      if (typeof col.count === 'number' && col.count !== col.records.length) {
        console.error(`  Warning: API says ${col.count} records but returned ${col.records.length}`)
      }
      return { name: col.name ?? id, count: col.records.length, records }
    } catch (err) {
      lastErr = err
      console.error(`  attempt ${attempt}/${FETCH_ATTEMPTS} failed: ${err.message}`)
      if (attempt < FETCH_ATTEMPTS) await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  throw lastErr
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { override } = parseArgs()
  const sources = (override ? [override] : URLS).map((u) => ({ url: u, id: collectionIdFrom(u) }))

  if (sources.length === 0) {
    console.error('No collections configured — edit the URLS constant in this script.')
    return
  }

  console.error(`DB: ${getDbUrl()}`)
  await ensureScrapeSchema()
  console.error(`Syncing ${sources.length} collection(s)`)

  // Per-collection bookkeeping for the summary.
  const collections = []
  // text → { record, collectionIndex } keeping the latest creation time.
  const byText = new Map()

  for (const [i, src] of sources.entries()) {
    console.error(`\n→ ${src.url}`)
    const entry = { id: src.id, name: src.id, count: 0, inserted: 0, readded: 0, error: null }
    collections.push(entry)
    try {
      const { name, count, records } = await fetchCollection(src.id)
      entry.name = name
      entry.count = count
      console.error(`  "${name}": ${count} records`)
      for (const rec of records) {
        const prev = byText.get(rec.source_text)
        if (!prev || rec.created_at > prev.record.created_at) {
          byText.set(rec.source_text, { record: rec, collectionIndex: i })
        }
      }
    } catch (err) {
      entry.error = err.message
      console.error(`  ✗ error: ${err.message}`)
    }
  }

  const merged = [...byText.values()].sort((a, b) => a.record.created_at - b.record.created_at)
  const sync = await syncScrapedRecords(merged.map((m) => m.record))

  // Attribute each inserted row to the collection its (latest) copy came from.
  for (const change of sync.changes) {
    const owner = byText.get(change.source_text)
    if (!owner) continue
    const entry = collections[owner.collectionIndex]
    if (change.kind === 'new') entry.inserted++
    else entry.readded++
    console.error(`  ${change.kind === 'new' ? '+' : '↻'} ${change.id}: "${change.source_text}"`)
  }

  // Auto-start learning on newly inserted (and re-added) cards so the user
  // gets a review reminder the next morning.
  let totalLearning = 0
  for (const id of sync.insertedIds) {
    if ((await startLearning(id, STARTING_LEARNING_DAYS)) > 0) totalLearning++
  }

  const failures = collections.filter((c) => c.error)
  console.error('\n── Sync summary ──')
  console.error(`  Collections     : ${collections.length - failures.length}/${collections.length}`)
  console.error(`  Records         : ${merged.length} unique`)
  console.error(`  New             : ${sync.inserted}`)
  console.error(`  Re-added        : ${sync.readded}`)
  console.error(`  Unchanged       : ${sync.skipped}`)
  console.error(`  Started learning: ${totalLearning} (days=${STARTING_LEARNING_DAYS})`)
  for (const c of collections) {
    console.error(
      `    - ${c.name}: ${c.error ? `✗ ${c.error}` : `${c.count} records, +${c.inserted} new, ↻${c.readded} re-added`}`,
    )
  }
  if (failures.length > 0) process.exitCode = 1

  console.error('\n── Enriching missing cards ──')
  const { processed, failed, skipped } = await enrichAllMissing()
  if (!skipped) {
    console.error(`  Enriched: ${processed}, failed: ${failed}`)
  }

  const summary = {
    collections,
    inserted: sync.inserted,
    readded: sync.readded,
    skipped: sync.skipped,
    learning: totalLearning,
    enriched: skipped ? null : processed,
    enrichFailed: skipped ? null : failed,
    enrichSkipped: skipped,
  }
  console.error(`SUMMARY ${JSON.stringify(summary)}`)
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
