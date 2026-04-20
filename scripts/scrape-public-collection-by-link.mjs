#!/usr/bin/env node

/**
 * Scrapes translation pairs from a public Yandex Translate collection page
 * and writes new pairs directly into the SQLite database at DATABASE_PATH.
 *
 * Usage:
 *   tsx scripts/scrape-public-collection-by-link.mjs <URL>
 *
 * Example:
 *   tsx scripts/scrape-public-collection-by-link.mjs "https://translate.yandex.ru/subscribe?collection_id=69713918c21400f565353437"
 *
 * New pairs get IDs assigned as MAX(id) + 1 so that "higher id = newer".
 * Duplicates (by source_text) are skipped.
 */

import 'dotenv/config'
import { chromium } from 'playwright'
import { insertCardsMissing, closeDb, getDbPath } from '../server/db.ts'

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.error('Usage: tsx scripts/scrape-public-collection-by-link.mjs <URL>')
    process.exit(args.length === 0 ? 1 : 0)
  }
  return { url: args[0] }
}

// ─── Main scrape logic ────────────────────────────────────────────────────────
async function scrapePublicCollection(url) {
  console.error('Launching browser…')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
  })

  const page = await context.newPage()

  console.error('Navigating to', url)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)

  await page.waitForSelector('li.record-item', { timeout: 15000 }).catch(() => {
    console.error('Warning: no li.record-item found within 15 s — page may not have loaded correctly.')
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

  console.error(`Scraped ${pairs.length} translation pairs.`)
  await browser.close()
  return pairs
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { url } = parseArgs()
  const scraped = await scrapePublicCollection(url)

  if (scraped.length === 0) {
    console.error('Nothing scraped — exiting.')
    return
  }

  console.error(`\nDB: ${getDbPath()}`)
  const { inserted, skipped } = insertCardsMissing(scraped)
  console.error(`  Scraped    : ${scraped.length}`)
  console.error(`  New        : ${inserted}`)
  console.error(`  Duplicates : ${skipped}`)
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    closeDb()
  })
