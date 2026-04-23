import Database from 'better-sqlite3'
import { resolve } from 'path'

export type LearningStatus = 'short' | 'long' | null

export type TranslationCard = {
  id: number
  source_text: string
  target_text: string
  examples_html: string | null
  learning_status: LearningStatus
  learning_days_remaining: number | null
}

export type ScrapedPair = {
  source_text: string
  target_text: string
}

export type PushSubscriptionRow = {
  endpoint: string
  p256dh: string
  auth: string
}

const DB_PATH = resolve(process.env.DATABASE_PATH ?? './deutsch-uben.db')

let instance: Database.Database | null = null

function addColumnIfMissing(db: Database.Database, table: string, column: string, ddl: string) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!info.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

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

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint   TEXT NOT NULL UNIQUE,
      p256dh     TEXT NOT NULL,
      auth       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  addColumnIfMissing(db, 'cards', 'learning_status', 'learning_status TEXT')
  addColumnIfMissing(db, 'cards', 'learning_days_remaining', 'learning_days_remaining INTEGER')
  instance = db
  return db
}

export function closeDb(): void {
  if (instance) {
    instance.close()
    instance = null
  }
}

const CARD_COLS =
  'id, source_text, target_text, examples_html, learning_status, learning_days_remaining'

export function listCards(): TranslationCard[] {
  const db = openDb()
  return db
    .prepare(`SELECT ${CARD_COLS} FROM cards WHERE deleted = 0 ORDER BY id DESC`)
    .all() as TranslationCard[]
}

export function getCardById(id: number): TranslationCard | null {
  const db = openDb()
  const row = db
    .prepare(`SELECT ${CARD_COLS} FROM cards WHERE id = ? AND deleted = 0`)
    .get(id) as TranslationCard | undefined
  return row ?? null
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
        `SELECT ${CARD_COLS} FROM cards WHERE id IN (${placeholders}) AND deleted = 0 ORDER BY id DESC`,
      )
      .all(...opts.ids) as TranslationCard[]
  }
  const base = `SELECT ${CARD_COLS} FROM cards WHERE examples_html IS NULL AND deleted = 0 ORDER BY id DESC`
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

// ─── Learning ────────────────────────────────────────────────────────────────

/**
 * Starts learning a card. Days is 1 if the server clock is already past today's
 * morning cron (9:00 Europe/Berlin), otherwise 2 — so the user never gets a
 * same-day notification.
 */
export function startLearning(id: number, days: number): number {
  const db = openDb()
  const info = db
    .prepare(
      `UPDATE cards SET learning_status = 'short', learning_days_remaining = ?
       WHERE id = ? AND deleted = 0`,
    )
    .run(days, id)
  return info.changes
}

export function resetLearning(id: number): number {
  const db = openDb()
  const info = db
    .prepare(
      `UPDATE cards SET learning_status = NULL, learning_days_remaining = NULL
       WHERE id = ? AND deleted = 0`,
    )
    .run(id)
  return info.changes
}

/** Cards in a given learning status that are due today (days=0). */
export function listLearningReady(status: 'short' | 'long'): TranslationCard[] {
  const db = openDb()
  return db
    .prepare(
      `SELECT ${CARD_COLS} FROM cards
       WHERE learning_status = ? AND learning_days_remaining = 0 AND deleted = 0
       ORDER BY id DESC`,
    )
    .all(status) as TranslationCard[]
}

/** 9 AM morning job, step 1: decrement every active countdown by 1 (floor at 0). */
export function decrementCountdowns(): number {
  const db = openDb()
  const info = db
    .prepare(
      `UPDATE cards
       SET learning_days_remaining = learning_days_remaining - 1
       WHERE learning_days_remaining > 0
         AND learning_status IS NOT NULL
         AND deleted = 0`,
    )
    .run()
  return info.changes
}

/** Cards ready to notify (days=0) grouped by status. */
export function listReadyToNotify(): { short: number; long: number } {
  const db = openDb()
  const rows = db
    .prepare(
      `SELECT learning_status AS status, COUNT(*) AS n FROM cards
       WHERE learning_days_remaining = 0 AND learning_status IS NOT NULL AND deleted = 0
       GROUP BY learning_status`,
    )
    .all() as Array<{ status: 'short' | 'long'; n: number }>
  const out = { short: 0, long: 0 }
  for (const r of rows) out[r.status] = r.n
  return out
}

/** 11 PM evening job: transition short→long (7 days) and long→null (cleared). */
export function transitionReady(): { shortToLong: number; longToNull: number } {
  const db = openDb()
  const shortToLong = db
    .prepare(
      `UPDATE cards
       SET learning_status = 'long', learning_days_remaining = 7
       WHERE learning_status = 'short' AND learning_days_remaining = 0 AND deleted = 0`,
    )
    .run().changes
  const longToNull = db
    .prepare(
      `UPDATE cards
       SET learning_status = NULL, learning_days_remaining = NULL
       WHERE learning_status = 'long' AND learning_days_remaining = 0 AND deleted = 0`,
    )
    .run().changes
  return { shortToLong, longToNull }
}

// ─── Push subscriptions ──────────────────────────────────────────────────────

export function upsertPushSubscription(sub: PushSubscriptionRow): void {
  const db = openDb()
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(sub.endpoint, sub.p256dh, sub.auth)
}

export function removePushSubscription(endpoint: string): number {
  const db = openDb()
  return db
    .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
    .run(endpoint).changes
}

export function listPushSubscriptions(): PushSubscriptionRow[] {
  const db = openDb()
  return db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions')
    .all() as PushSubscriptionRow[]
}

export function getDbPath(): string {
  return DB_PATH
}
