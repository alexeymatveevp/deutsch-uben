#!/usr/bin/env node

/**
 * One-time migration: reads src/data/data.json and writes all non-soft-deleted
 * cards into a SQLite database at DATABASE_PATH (default: ./deutsch-uben.db).
 *
 * Usage:
 *   node scripts/migrate-to-sqlite.mjs
 *
 * The script is idempotent — it drops and recreates the `cards` table, so
 * rerunning it against the same DB produces the same result.
 *
 * Pantry Cloud has been retired. Any IDs that were soft-deleted only in
 * Pantry (and not in data.json) will be migrated as active rows. Delete
 * them in-app or with a SQL DELETE after migration.
 */

import 'dotenv/config'
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_JSON = resolve(__dirname, '../src/data/data.json')
const DB_PATH = resolve(process.env.DATABASE_PATH ?? './deutsch-uben.db')

const SCHEMA = `
DROP TABLE IF EXISTS cards;
CREATE TABLE cards (
  id            INTEGER PRIMARY KEY,
  source_text   TEXT NOT NULL UNIQUE,
  target_text   TEXT NOT NULL,
  examples_html TEXT,
  deleted       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_cards_id_desc ON cards(id DESC);
`

function main() {
  console.error(`Reading ${DATA_JSON}`)
  const raw = readFileSync(DATA_JSON, 'utf-8')
  /** @type {Array<{id:number, source_text:string, target_text:string, examples_html:string|null, deleted?:boolean}>} */
  const rows = JSON.parse(raw)

  const source = rows.length
  const softDeleted = rows.filter((r) => r.deleted).length

  console.error(`Opening DB at ${DB_PATH}`)
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(SCHEMA)

  const insert = db.prepare(
    'INSERT INTO cards (id, source_text, target_text, examples_html, deleted) VALUES (?, ?, ?, ?, ?)',
  )
  const insertAll = db.transaction((items) => {
    for (const r of items) {
      insert.run(
        r.id,
        r.source_text,
        r.target_text,
        r.examples_html ?? null,
        r.deleted ? 1 : 0,
      )
    }
  })
  insertAll(rows)

  const count = db.prepare('SELECT COUNT(*) AS n FROM cards').get().n
  db.close()

  console.error(`Inserted ${count} cards (source=${source}, soft_deleted=${softDeleted})`)
  if (count !== source) {
    console.error(`ERROR: expected ${source} rows, got ${count}`)
    process.exit(1)
  }
}

main()
