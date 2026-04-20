import Database from 'better-sqlite3'
import { resolve } from 'path'

export type TranslationCard = {
  id: number
  source_text: string
  target_text: string
  examples_html: string | null
}

export type ScrapedPair = {
  source_text: string
  target_text: string
}

const DB_PATH = resolve(process.env.DATABASE_PATH ?? './deutsch-uben.db')

let instance: Database.Database | null = null

export function openDb(): Database.Database {
  if (instance) return instance
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id            INTEGER PRIMARY KEY,
      source_text   TEXT NOT NULL UNIQUE,
      target_text   TEXT NOT NULL,
      examples_html TEXT,
      deleted       INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cards_id_desc ON cards(id DESC);
  `)
  instance = db
  return db
}

export function closeDb(): void {
  if (instance) {
    instance.close()
    instance = null
  }
}

export function listCards(): TranslationCard[] {
  const db = openDb()
  return db
    .prepare(
      'SELECT id, source_text, target_text, examples_html FROM cards WHERE deleted = 0 ORDER BY id DESC',
    )
    .all() as TranslationCard[]
}

export function deleteCardById(id: number): number {
  const db = openDb()
  const info = db
    .prepare('UPDATE cards SET deleted = 1 WHERE id = ? AND deleted = 0')
    .run(id)
  return info.changes
}

export function insertCardsMissing(
  pairs: ScrapedPair[],
): { inserted: number; skipped: number; insertedIds: number[] } {
  const db = openDb()
  const exists = db.prepare('SELECT 1 FROM cards WHERE source_text = ?')
  const maxIdStmt = db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM cards')
  const insert = db.prepare(
    'INSERT INTO cards (id, source_text, target_text, examples_html) VALUES (?, ?, ?, NULL)',
  )

  const run = db.transaction((rows: ScrapedPair[]) => {
    let inserted = 0
    let skipped = 0
    const insertedIds: number[] = []
    let nextId = (maxIdStmt.get() as { max_id: number }).max_id + 1
    for (const row of rows) {
      if (exists.get(row.source_text)) {
        skipped++
        continue
      }
      insert.run(nextId, row.source_text, row.target_text)
      insertedIds.push(nextId)
      nextId++
      inserted++
    }
    return { inserted, skipped, insertedIds }
  })

  return run(pairs)
}

export function listCardsWithoutExamples(opts: {
  limit?: number
  ids?: number[]
} = {}): TranslationCard[] {
  const db = openDb()
  if (opts.ids && opts.ids.length > 0) {
    const placeholders = opts.ids.map(() => '?').join(',')
    return db
      .prepare(
        `SELECT id, source_text, target_text, examples_html FROM cards WHERE id IN (${placeholders}) AND deleted = 0 ORDER BY id DESC`,
      )
      .all(...opts.ids) as TranslationCard[]
  }
  const base = 'SELECT id, source_text, target_text, examples_html FROM cards WHERE examples_html IS NULL AND deleted = 0 ORDER BY id DESC'
  if (opts.limit && opts.limit > 0) {
    return db.prepare(`${base} LIMIT ?`).all(opts.limit) as TranslationCard[]
  }
  return db.prepare(base).all() as TranslationCard[]
}

export function updateExamplesHtml(id: number, html: string): number {
  const db = openDb()
  const info = db.prepare('UPDATE cards SET examples_html = ? WHERE id = ?').run(html, id)
  return info.changes
}

export function getDbPath(): string {
  return DB_PATH
}
