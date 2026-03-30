#!/usr/bin/env node

/**
 * Enriches data.json entries with LLM-generated German usage examples.
 *
 * Usage:
 *   node scripts/enrich-data.mjs --sync
 *   OPENAI_API_KEY=sk-... node scripts/enrich-data.mjs [--limit N] [--ids 1109,1108] [--model gpt-4o]
 *
 * Options:
 *   --sync           Sync data.json from yandex-collections.json (add new items, keep existing examples)
 *   --limit N        Process only the first N items that have no examples yet
 *   --ids 1109,1108  Process only these specific IDs
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

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: 0, ids: /** @type {number[]} */ ([]), model: "gpt-4o", dryRun: false, sync: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    else if (args[i] === "--ids" && args[i + 1]) opts.ids = args[++i].split(",").map(Number);
    else if (args[i] === "--model" && args[i + 1]) opts.model = args[++i];
    else if (args[i] === "--dry-run") opts.dryRun = true;
    else if (args[i] === "--sync") opts.sync = true;
  }
  return opts;
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

Antworte nur auf Deutsch. Benutze Markdown-Formatierung.`;
}

// ─── Sync data.json from yandex-collections.json ─────────────────────────────
function syncFromCollections() {
  const source = JSON.parse(readFileSync(COLLECTIONS_JSON, "utf-8"));
  let data;
  try {
    data = JSON.parse(readFileSync(DATA_JSON, "utf-8"));
  } catch {
    data = [];
  }

  // Build a lookup of existing items by source_text to preserve examples_html
  const existingByText = new Map();
  for (const item of data) {
    existingByText.set(item.source_text, item);
  }

  // Rebuild: same order as source, IDs assigned so last item = 1
  const total = source.length;
  const synced = source.map((entry, i) => {
    const existing = existingByText.get(entry.source_text);
    return {
      id: total - i,
      source_text: entry.source_text,
      target_text: entry.target_text,
      examples_html: existing?.examples_html ?? null,
    };
  });

  writeFileSync(DATA_JSON, JSON.stringify(synced, null, 2) + "\n");

  const newCount = synced.filter((s) => !existingByText.has(s.source_text)).length;
  const keptExamples = synced.filter((s) => s.examples_html).length;
  console.error(`Synced: ${synced.length} items (${newCount} new, ${keptExamples} with examples preserved)`);
  return synced;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  if (opts.sync) {
    syncFromCollections();
    return;
  }

  const data = JSON.parse(readFileSync(DATA_JSON, "utf-8"));
  console.error(`Loaded ${data.length} items from data.json`);

  // Select items to process
  let toProcess;
  if (opts.ids.length > 0) {
    const idSet = new Set(opts.ids);
    toProcess = data.filter((item) => idSet.has(item.id));
    if (toProcess.length === 0) {
      console.error(`No items found with IDs: ${opts.ids.join(", ")}`);
      process.exit(1);
    }
  } else {
    // Pick items that don't have examples yet
    toProcess = data.filter((item) => !item.examples_html);
    if (opts.limit > 0) toProcess = toProcess.slice(0, opts.limit);
  }

  console.error(`Will process ${toProcess.length} items`);

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

      // Update the item in the original data array
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
