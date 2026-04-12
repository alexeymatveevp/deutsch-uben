#!/usr/bin/env node

/**
 * Syncs data.json from yandex-collections.json and Pantry, and optionally
 * enriches entries with LLM-generated German usage examples.
 *
 * Usage:
 *   node scripts/enrich-data.mjs                          # sync only
 *   node scripts/enrich-data.mjs --limit 5                # sync + enrich 5 items
 *   node scripts/enrich-data.mjs --ids 1109,1108          # sync + enrich specific IDs
 *   node scripts/enrich-data.mjs --limit 2 --model gpt-4o-mini
 *   node scripts/enrich-data.mjs --dry-run                # print prompt, no API call
 *
 * Options:
 *   --limit N        Enrich the first N items that have no examples yet
 *   --ids 1109,1108  Enrich specific items by ID
 *   --model NAME     OpenAI model to use (default: gpt-4o)
 *   --dry-run        Print the prompt for the first item and exit
 */

import "dotenv/config";
import OpenAI from "openai";
import { marked } from "marked";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_JSON = resolve(__dirname, "../src/data/data.json");
const COLLECTIONS_JSON = resolve(__dirname, "../src/data/yandex-collections.json");

const PANTRY_ID = process.env.VITE_PANTRY_ID;
const BASKET = "deleted-cards";
const PANTRY_URL = PANTRY_ID
  ? `https://getpantry.cloud/apiv1/pantry/${PANTRY_ID}/basket/${BASKET}`
  : null;

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: 0, ids: /** @type {number[]} */ ([]), model: "gpt-4o", dryRun: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    else if (args[i] === "--ids" && args[i + 1]) opts.ids = args[++i].split(",").map(Number);
    else if (args[i] === "--model" && args[i + 1]) opts.model = args[++i];
    else if (args[i] === "--dry-run") opts.dryRun = true;
  }
  return opts;
}

// ─── Pantry helpers ──────────────────────────────────────────────────────────
async function fetchDeletedIds() {
  if (!PANTRY_URL) {
    console.error("No VITE_PANTRY_ID set — skipping Pantry sync.");
    return [];
  }
  try {
    const res = await fetch(PANTRY_URL);
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    return Array.isArray(data.ids) ? data.ids : [];
  } catch {
    console.error("Pantry basket not found or empty — no deletions to process.");
    return [];
  }
}

async function clearPantryBasket() {
  if (!PANTRY_URL) return;
  try {
    // Replace basket with empty ids array
    const res = await fetch(PANTRY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [] }),
    });
    if (!res.ok) throw new Error(res.statusText);
    console.error("Pantry basket cleared.");
  } catch (err) {
    console.error(`Warning: could not clear Pantry basket: ${err.message}`);
  }
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

Antworte nur auf Deutsch. Benutze Markdown-Formatierung.`;
}

// ─── Sync data.json from yandex-collections.json + Pantry ────────────────────
async function syncFromCollections() {
  const source = JSON.parse(readFileSync(COLLECTIONS_JSON, "utf-8"));
  let data;
  try {
    data = JSON.parse(readFileSync(DATA_JSON, "utf-8"));
  } catch {
    data = [];
  }

  // Fetch deleted IDs from Pantry
  const pantryDeletedIds = await fetchDeletedIds();
  console.error(`Pantry deleted IDs: ${pantryDeletedIds.length}`);

  // Collect all previously deleted IDs from data.json
  const alreadyDeleted = new Set(
    data.filter((item) => item.deleted).map((item) => item.id)
  );

  // Build a lookup of existing items by source_text to preserve fields
  const existingByText = new Map();
  for (const item of data) {
    existingByText.set(item.source_text, item);
  }

  // Merge pantry deletions: map pantry IDs to source_texts so we can mark them
  const pantryDeletedTexts = new Set();
  for (const id of pantryDeletedIds) {
    const item = data.find((d) => d.id === id);
    if (item) pantryDeletedTexts.add(item.source_text);
  }

  // Rebuild: same order as source, IDs assigned so last item = 1
  const total = source.length;
  const synced = source.map((entry, i) => {
    const existing = existingByText.get(entry.source_text);
    const deleted = existing?.deleted || pantryDeletedTexts.has(entry.source_text);
    return {
      id: total - i,
      source_text: entry.source_text,
      target_text: entry.target_text,
      examples_html: existing?.examples_html ?? null,
      ...(deleted ? { deleted: true } : {}),
    };
  });

  writeFileSync(DATA_JSON, JSON.stringify(synced, null, 2) + "\n");

  const newCount = synced.filter((s) => !existingByText.has(s.source_text)).length;
  const keptExamples = synced.filter((s) => s.examples_html).length;
  const deletedCount = synced.filter((s) => s.deleted).length;
  const newlyDeleted = pantryDeletedIds.length;
  console.error(`Synced: ${synced.length} items (${newCount} new, ${keptExamples} with examples, ${deletedCount} deleted total, ${newlyDeleted} from Pantry)`);

  // Clear Pantry basket after successful sync
  if (pantryDeletedIds.length > 0) {
    await clearPantryBasket();
  }

  return synced;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();
  const wantsEnrich = opts.ids.length > 0 || opts.limit > 0 || opts.dryRun;

  // Always sync first
  await syncFromCollections();

  if (!wantsEnrich) return;

  // ── LLM enrichment ──────────────────────────────────────────────────────
  const data = JSON.parse(readFileSync(DATA_JSON, "utf-8"));
  const active = data.filter((item) => !item.deleted);
  console.error(`\n${active.length} active items available for enrichment`);

  let toProcess;
  if (opts.ids.length > 0) {
    const idSet = new Set(opts.ids);
    toProcess = active.filter((item) => idSet.has(item.id));
    if (toProcess.length === 0) {
      console.error(`No active items found with IDs: ${opts.ids.join(", ")}`);
      process.exit(1);
    }
  } else {
    toProcess = active.filter((item) => !item.examples_html);
    if (opts.limit > 0) toProcess = toProcess.slice(0, opts.limit);
  }

  console.error(`Will enrich ${toProcess.length} items`);

  if (opts.dryRun) {
    const item = toProcess[0];
    console.log("=== DRY RUN — Prompt for ID", item.id, "===");
    console.log(buildPrompt(item.source_text, item.target_text));
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("ERROR: Set OPENAI_API_KEY environment variable.");
    process.exit(1);
  }

  const openai = new OpenAI();

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    console.error(`[${i + 1}/${toProcess.length}] ID ${item.id}: "${item.source_text}"…`);

    try {
      const response = await openai.chat.completions.create({
        model: opts.model,
        messages: [
          { role: "user", content: buildPrompt(item.source_text, item.target_text) },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const markdown = response.usage
        ? (console.error(`  tokens: ${response.usage.prompt_tokens}+${response.usage.completion_tokens}`),
          response.choices[0].message.content)
        : response.choices[0].message.content;

      const html = await marked.parse(markdown);

      // Update the item in the full data array
      const idx = data.findIndex((d) => d.id === item.id);
      data[idx].examples_html = html;

      // Save after each item so progress isn't lost
      writeFileSync(DATA_JSON, JSON.stringify(data, null, 2) + "\n");
      console.error(`  ✓ saved`);
    } catch (err) {
      console.error(`  ✗ error: ${err.message}`);
    }
  }

  console.error("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
