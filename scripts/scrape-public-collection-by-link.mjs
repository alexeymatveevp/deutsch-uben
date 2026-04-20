#!/usr/bin/env node

/**
 * Scrapes translation pairs from one or more public Yandex Translate
 * collection pages and writes new pairs directly into the SQLite database
 * at DATABASE_PATH.
 *
 * Usage:
 *   tsx scripts/scrape-public-collection-by-link.mjs            # scrape the URLS list below
 *   tsx scripts/scrape-public-collection-by-link.mjs <URL>      # scrape just that URL
 *
 * Scheduling (cron on the VPS):
 *   0 5 * * *  cd /srv/deutsch-uben && /usr/bin/env npx tsx scripts/scrape-public-collection-by-link.mjs >> /var/log/deutsch-uben-scrape.log 2>&1
 *
 * New pairs get IDs assigned as MAX(id) + 1 so that "higher id = newer".
 * Duplicates (by source_text) are skipped — including rows that were
 * soft-deleted.
 */

import 'dotenv/config'
import { chromium } from 'playwright'
import { insertCardsMissing, closeDb, getDbPath } from '../server/db.ts'

// ─── Hardcoded URL list for scheduled runs ────────────────────────────────────
// Populate these with the collection URLs to scrape daily.
const URLS = [
  'https://translate.yandex.ru/subscribe?collection_id=69713918c21400f565353437&utm_source=collection_share_ios',
  'https://translate.yandex.ru/subscribe?collection_id=69cb965c5f298af7bab72d7d&utm_source=new_collection_share_desktop',
]

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  if (args[0] === '--help' || args[0] === '-h') {
    console.error(
      'Usage: tsx scripts/scrape-public-collection-by-link.mjs [<URL>]\n' +
        '  With no argument, scrapes the hardcoded URLS list.\n' +
        '  With a URL argument, scrapes just that URL.',
    )
    process.exit(0)
  }
  return { urlOverride: args[0] ?? null }
}

// ─── Scrape one page (browser-agnostic) ───────────────────────────────────────
async function scrapePage(page, url) {
  console.error(`\n→ ${url}`)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)

  await page.waitForSelector('li.record-item', { timeout: 15000 }).catch(() => {
    console.error('  Warning: no li.record-item found within 15 s — page may not have loaded correctly.')
  })

  const pairs = await page.evaluate(() => {
    const results = []
    for (const item of document.querySelectorAll('li.record-item')) {
      const sourceEl = item.querySelector('.record-item_text')
      const targetEl = item.querySelector('.record-item_translation')
      if (!sourceEl || !targetEl) continue

      const source_text = sourceEl.textContent.trim()
      const target_text = targetEl.textContent.trim()
      if (source_text && target_text) {
        results.push({ source_text, target_text })
      }
    }
    return results
  })

  console.error(`  scraped ${pairs.length} pairs`)
  return pairs
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { urlOverride } = parseArgs()
  const urls = urlOverride ? [urlOverride] : URLS

  if (urls.length === 0) {
    console.error('No URLs configured — edit the URLS constant in this script.')
    return
  }
  if (!urlOverride && URLS.some((u) => u.includes('REPLACE_ME'))) {
    console.error('URLS list still contains REPLACE_ME placeholders — edit the script before scheduling.')
    process.exitCode = 1
    return
  }

  console.error(`DB: ${getDbPath()}`)
  console.error(`Scraping ${urls.length} URL(s)`)

  console.error('Launching browser…')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  let totalScraped = 0
  let totalInserted = 0
  let totalSkipped = 0
  const failures = []

  try {
    for (const url of urls) {
      try {
        const pairs = await scrapePage(page, url)
        totalScraped += pairs.length
        if (pairs.length > 0) {
          const { inserted, skipped } = insertCardsMissing(pairs)
          totalInserted += inserted
          totalSkipped += skipped
          console.error(`  new: ${inserted}, duplicates: ${skipped}`)
        }
      } catch (err) {
        console.error(`  ✗ error: ${err.message}`)
        failures.push({ url, error: err.message })
      }
    }
  } finally {
    await browser.close()
  }

  console.error('\n── Summary ──')
  console.error(`  URLs processed : ${urls.length - failures.length}/${urls.length}`)
  console.error(`  Scraped pairs  : ${totalScraped}`)
  console.error(`  New            : ${totalInserted}`)
  console.error(`  Duplicates     : ${totalSkipped}`)
  if (failures.length > 0) {
    console.error(`  Failures       : ${failures.length}`)
    for (const f of failures) console.error(`    - ${f.url}: ${f.error}`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    closeDb()
  })
