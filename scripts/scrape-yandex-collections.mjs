#!/usr/bin/env node

// ARCHIVED: this script is no longer part of the data pipeline.
// It used to scrape https://translate.yandex.ru/collections and merge
// results into src/data/yandex-collections.json. The app now stores
// everything in SQLite and ingests new cards via
// scripts/scrape-public-collection-by-link.mjs writing directly to the DB.
// Kept in the repo for reference / historical context.

console.error(
  '[scrape-yandex-collections] archived — use scrape-public-collection-by-link.mjs instead.',
)
process.exit(0)

/*
import "dotenv/config";
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COLLECTIONS_JSON = resolve(__dirname, "../src/data/yandex-collections.json");
const BASE_URL = "https://translate.yandex.ru/collections";

const COOKIE = process.env.COOKIE || "";

// How many pixels to scroll the list container per step.
// Smaller = more overlap / safer for fast-rendering lists.
const SCROLL_STEP = 200;
// How long to wait after each scroll for the virtual list to re-render (ms).
const SCROLL_WAIT = 400;
// Give up after this many consecutive steps with zero new items.
const MAX_IDLE_STEPS = 12;

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: 0, merge: false, output: "", debug: false };
  for (let i = 0; i < args.length; i++) {
    if      (args[i] === "--limit"  && args[i + 1]) opts.limit  = parseInt(args[++i], 10);
    else if (args[i] === "--merge")                  opts.merge  = true;
    else if (args[i] === "--output" && args[i + 1]) opts.output = args[++i];
    else if (args[i] === "--debug")                  opts.debug  = true;
  }
  if (!COOKIE) {
    console.error("ERROR: COOKIE is empty. Paste your cookie string into the COOKIE constant at the top of the script.");
    process.exit(1);
  }
  return opts;
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────
function parseCookies(cookieStr, url) {
  const { hostname } = new URL(url);
  return cookieStr.split(";").map((pair) => {
    const eqIdx = pair.indexOf("=");
    return {
      name:   pair.substring(0, eqIdx).trim(),
      value:  pair.substring(eqIdx + 1).trim(),
      domain: hostname,
      path:   "/",
    };
  });
}

// ─── Main scrape logic ────────────────────────────────────────────────────────
async function scrapeCollections(opts) {
  console.error("Launching browser…");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    locale:    "ru-RU",
    viewport:  { width: 1440, height: 900 },
  });

  await context.addCookies(parseCookies(COOKIE, BASE_URL));
  const page = await context.newPage();

  // ── 1. Load the collections page ──────────────────────────────────────────
  console.error("Navigating to", BASE_URL);
  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);

  if (opts.debug) {
    await page.screenshot({ path: "debug-1-loaded.png", fullPage: false });
    console.error("Saved debug-1-loaded.png");
  }

  // ── 2. Find collections in the left sidebar & select the one with most items ─
  // The page defaults to "Избранное" which is already selected.  We only need to
  // click a different collection when the default one has no items but another does.
  const collections = await page.evaluate(() => {
    const items = [];
    // Collection entries in the sidebar are <li role="tab"> inside a <ul role="tablist">.
    // Each entry's innerText is "Name\n<count>".
    for (const tab of document.querySelectorAll('[role="tab"]')) {
      const txt = tab.innerText?.trim();
      if (!txt) continue;
      const match = txt.match(/^(.+?)\s*\n\s*(\d+)$/);
      if (match) {
        items.push({ name: match[1].trim(), count: parseInt(match[2], 10) });
      }
    }
    items.sort((a, b) => b.count - a.count);
    return items;
  });

  console.error("Collections found:", JSON.stringify(collections));

  // Check if listitems are already visible (default collection may already be loaded).
  const alreadyHasItems = await page.evaluate(
    () => document.querySelectorAll('[role="listitem"]').length > 0,
  );

  if (!alreadyHasItems && collections.length > 0) {
    // Find the collection with the most items (skip 0-count ones).
    const target = collections.find((c) => c.count > 0);
    if (target) {
      console.error(`Clicking collection "${target.name}" (${target.count} items)…`);
      const clicked = await page.evaluate((targetName) => {
        for (const tab of document.querySelectorAll('[role="tab"]')) {
          if (tab.innerText?.trim().startsWith(targetName)) {
            tab.click();
            return true;
          }
        }
        return false;
      }, target.name);
      if (!clicked) console.error("Warning: could not click the target collection.");
      await page.waitForTimeout(2000);
      await page.waitForLoadState("networkidle").catch(() => {});
    } else {
      console.error("All collections have 0 items — nothing to scrape.");
    }
  } else if (alreadyHasItems) {
    console.error("Items already visible — using the currently selected collection.");
  } else {
    console.error("No collections found in sidebar — will try scraping whatever is visible.");
  }

  if (opts.debug) {
    await page.screenshot({ path: "debug-2-collection-open.png", fullPage: false });
    console.error("Saved debug-2-collection-open.png");
  }

  // ── 3. Find the scrollable container that holds role="listitem" ───────────
  // Wait up to 15 s for at least one listitem to appear.
  await page.waitForSelector('[role="listitem"]', { timeout: 15000 }).catch(() => {
    console.error("Warning: no role=listitem found within 15 s — page may not have loaded correctly.");
  });

  // Identify the nearest scrollable ancestor of the first listitem.
  // The page has: main > .collections-wrapper > … > tabpanel (overflow-y: auto)
  //   → left panel (sidebar) + right panel (.m4Yjn9BUTPTs91GddT_A)
  //     → nested tabpanel with a scrollable div containing the listitems.
  const containerInfo = await page.evaluate(() => {
    const firstItem = document.querySelector('[role="listitem"]');
    if (!firstItem) return null;

    // Walk up the DOM to find the first scrollable ancestor with actual overflow.
    let el = firstItem.parentElement;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      const ov = style.overflowY;
      if ((ov === "auto" || ov === "scroll") && el.scrollHeight > el.clientHeight) {
        el.setAttribute("data-scraper-scroll", "1");
        return {
          tag:          el.tagName,
          className:    el.className?.substring(0, 120),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        };
      }
      el = el.parentElement;
    }
    // Fall back to document.documentElement.
    document.documentElement.setAttribute("data-scraper-scroll", "1");
    return {
      tag:          "HTML",
      className:    "",
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    };
  });

  console.error("Scroll container:", JSON.stringify(containerInfo));

  if (opts.debug) {
    await page.screenshot({ path: "debug-3-listitems.png", fullPage: false });
    console.error("Saved debug-3-listitems.png");
  }

  // ── 4. Virtualized scroll loop ────────────────────────────────────────────
  const collected = new Map(); // source_text → target_text
  let idleSteps   = 0;
  let step        = 0;
  const limit     = opts.limit > 0 ? opts.limit : Infinity;

  while (idleSteps < MAX_IDLE_STEPS && collected.size < limit) {
    // Harvest all currently rendered listitems.
    const pairs = await page.evaluate(() => {
      const results = [];
      const items = document.querySelectorAll('[role="listitem"]');

      for (const item of items) {
        // Each listitem has two direct child divs:
        //   [0] language header ("Немецкий → Русский") — skip this
        //   [1] translation content (source text, target text, buttons)
        const children = [...item.children];
        // Use the second child (translation content) if available,
        // otherwise fall back to the whole item.
        const contentRoot = children.length >= 2 ? children[1] : item;

        const walker = document.createTreeWalker(contentRoot, NodeFilter.SHOW_TEXT, null);
        const texts  = [];
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent.trim();
          // Skip empty strings, pure numbers (like counters), and very long blobs.
          if (t && t.length > 1 && t.length < 600 && !/^\d+$/.test(t)) {
            texts.push(t);
          }
        }

        // We expect at least 2 meaningful texts: source + target.
        if (texts.length >= 2) {
          results.push({ source_text: texts[0], target_text: texts[1] });
        }
      }
      return results;
    });

    const prevSize = collected.size;
    for (const { source_text, target_text } of pairs) {
      if (!collected.has(source_text)) {
        collected.set(source_text, target_text);
      }
    }

    const newItems = collected.size - prevSize;
    step++;
    if (step % 5 === 0 || newItems > 0) {
      console.error(`Step ${step}: ${pairs.length} visible, +${newItems} new → ${collected.size} total`);
    }

    if (newItems === 0) {
      idleSteps++;
    } else {
      idleSteps = 0;
    }

    // Scroll the container by SCROLL_STEP pixels.
    const reachedEnd = await page.evaluate((step) => {
      const container = document.querySelector("[data-scraper-scroll]");
      if (!container || container.tagName === "HTML") {
        window.scrollBy(0, step);
        return window.scrollY + window.innerHeight >= document.body.scrollHeight - 10;
      }
      container.scrollTop += step;
      return container.scrollTop + container.clientHeight >= container.scrollHeight - 10;
    }, SCROLL_STEP);

    await page.waitForTimeout(SCROLL_WAIT);

    if (reachedEnd) {
      console.error("Reached end of scroll container.");
      // Do a couple more harvests to catch any last items.
      if (idleSteps >= 3) break;
    }
  }

  console.error(`\nDone. Scraped ${collected.size} unique translation pairs.`);
  await browser.close();

  return [...collected.entries()].map(([source_text, target_text]) => ({
    source_text,
    target_text,
  }));
}

// ─── Output / merge ───────────────────────────────────────────────────────────
async function main() {
  const opts   = parseArgs();
  const scraped = await scrapeCollections(opts);

  if (opts.merge) {
    console.error(`\nMerging into ${COLLECTIONS_JSON}…`);
    const existing    = JSON.parse(readFileSync(COLLECTIONS_JSON, "utf-8"));
    const existingSet = new Set(existing.map((e) => e.source_text));
    const newEntries  = scraped.filter((e) => !existingSet.has(e.source_text));

    console.error(`  Existing : ${existing.length}`);
    console.error(`  Scraped  : ${scraped.length}`);
    console.error(`  New      : ${newEntries.length}`);

    const merged = [...newEntries, ...existing];
    writeFileSync(COLLECTIONS_JSON, JSON.stringify(merged, null, 2) + "\n");
    console.error(`  Written  : ${merged.length} entries → ${COLLECTIONS_JSON}`);

  } else if (opts.output) {
    writeFileSync(opts.output, JSON.stringify(scraped, null, 2) + "\n");
    console.error(`Written ${scraped.length} entries to ${opts.output}`);

  } else {
    process.stdout.write(JSON.stringify(scraped, null, 2) + "\n");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
*/
