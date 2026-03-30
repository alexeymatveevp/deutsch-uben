# scrape-yandex-collections

Scrapes translation pairs from [Yandex Translate Collections](https://translate.yandex.ru/collections) and saves them as JSON.

## Prerequisites

- Node.js
- Playwright (`npm install`)

## Getting a cookie

1. Open https://translate.yandex.ru/collections in your browser while logged in
2. Open DevTools → Network → pick any request to `translate.yandex.ru`
3. Copy the `Cookie` header value
4. Paste it into the `COOKIE` constant at the top of `scrape-yandex-collections.mjs`

## Usage

```bash
# Print all translations to stdout
node scripts/scrape-yandex-collections.mjs

# Merge new translations into src/data/yandex-collections.json
node scripts/scrape-yandex-collections.mjs --merge

# Scrape only the first 50 translations
node scripts/scrape-yandex-collections.mjs --limit 50

# Save to a custom file
node scripts/scrape-yandex-collections.mjs --output my-translations.json

# Enable debug screenshots (debug-1-loaded.png, debug-2-collection-open.png, etc.)
node scripts/scrape-yandex-collections.mjs --debug
```

Flags can be combined, e.g.:

```bash
node scripts/scrape-yandex-collections.mjs --merge --debug --limit 200
```

## enrich-data

Enriches `src/data/data.json` entries with LLM-generated German usage examples (grammar info + natural example sentences). Uses the OpenAI API.

### Usage

```bash
# Enrich the first 2 items that don't have examples yet
OPENAI_API_KEY=sk-... node scripts/enrich-data.mjs --limit 2

# Enrich specific items by ID
OPENAI_API_KEY=sk-... node scripts/enrich-data.mjs --ids 9999,9998

# Use a different model
OPENAI_API_KEY=sk-... node scripts/enrich-data.mjs --limit 5 --model gpt-4o-mini

# Preview the prompt without calling the API
node scripts/enrich-data.mjs --dry-run
```

Progress is saved after each item, so the script can be interrupted and resumed safely.