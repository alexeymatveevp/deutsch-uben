#!/usr/bin/env node

/**
 * Scrapes translation pairs from a public Yandex Translate collection page.
 *
 * Usage:
 *   node scripts/scrape-public-collection-by-link.mjs <URL>
 *
 * Example:
 *   node scripts/scrape-public-collection-by-link.mjs "https://translate.yandex.ru/subscribe?collection_id=69713918c21400f565353437&utm_source=collection_share_ios"
 *
 * Scraped pairs are merged into src/data/yandex-collections.json (new entries prepended).
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COLLECTIONS_JSON = resolve(__dirname, "../src/data/yandex-collections.json");

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.error("Usage: node scripts/scrape-public-collection-by-link.mjs <URL>");
    process.exit(args.length === 0 ? 1 : 0);
  }
  return { url: args[0] };
}

// ─── Main scrape logic ────────────────────────────────────────────────────────
async function scrapePublicCollection(url) {
  console.error("Launching browser…");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    locale: "ru-RU",
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  console.error("Navigating to", url);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Wait for translation items to render.
  await page
    .waitForSelector("li.record-item", { timeout: 15000 })
    .catch(() => {
      console.error(
        "Warning: no li.record-item found within 15 s — page may not have loaded correctly.",
      );
    });

  // Extract all translation pairs.
  const pairs = await page.evaluate(() => {
    const results = [];
    for (const item of document.querySelectorAll("li.record-item")) {
      const sourceEl = item.querySelector(".record-item_text");
      const targetEl = item.querySelector(".record-item_translation");
      if (!sourceEl || !targetEl) continue;

      const source_text = sourceEl.textContent.trim();
      const target_text = targetEl.textContent.trim();
      if (source_text && target_text) {
        results.push({ source_text, target_text });
      }
    }
    return results;
  });

  console.error(`Scraped ${pairs.length} translation pairs.`);
  await browser.close();
  return pairs;
}

// ─── Merge & output ──────────────────────────────────────────────────────────
async function main() {
  const { url } = parseArgs();
  const scraped = await scrapePublicCollection(url);

  if (scraped.length === 0) {
    console.error("Nothing scraped — exiting.");
    process.exit(0);
  }

  console.error(`\nMerging into ${COLLECTIONS_JSON}…`);

  let existing = [];
  try {
    existing = JSON.parse(readFileSync(COLLECTIONS_JSON, "utf-8"));
  } catch {
    console.error("  No existing file found — creating a new one.");
  }

  const existingSet = new Set(existing.map((e) => e.source_text));
  const newEntries = scraped.filter((e) => !existingSet.has(e.source_text));

  console.error(`  Existing : ${existing.length}`);
  console.error(`  Scraped  : ${scraped.length}`);
  console.error(`  New      : ${newEntries.length}`);

  const merged = [...newEntries, ...existing];
  writeFileSync(COLLECTIONS_JSON, JSON.stringify(merged, null, 2) + "\n");
  console.error(`  Written  : ${merged.length} entries → ${COLLECTIONS_JSON}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
