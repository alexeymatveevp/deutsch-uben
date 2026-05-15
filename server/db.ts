import { Pool } from 'pg'

export type LearningStatus = 'short' | 'long' | null
export type CardCategory = 'ausdruck' | 'favorite' | null

export type TranslationCard = {
  id: number
  source_text: string
  target_text: string
  examples_html: string | null
  learning_status: LearningStatus
  learning_days_remaining: number | null
  category: CardCategory
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

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required (postgresql://...)')
}

let pool: Pool | null = null

export function openDb(): Pool {
  if (pool) return pool
  pool = new Pool({ connectionString: DATABASE_URL })
  return pool
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

const CARD_COLS =
  'id, source_text, target_text, examples_html, learning_status, learning_days_remaining, category'

export async function listCards(): Promise<TranslationCard[]> {
  const db = openDb()
  const { rows } = await db.query<TranslationCard>(
    `SELECT ${CARD_COLS} FROM cards WHERE deleted = 0 ORDER BY id DESC`,
  )
  return rows
}

export async function getCardById(id: number): Promise<TranslationCard | null> {
  const db = openDb()
  const { rows } = await db.query<TranslationCard>(
    `SELECT ${CARD_COLS} FROM cards WHERE id = $1 AND deleted = 0`,
    [id],
  )
  return rows[0] ?? null
}

export async function deleteCardById(id: number): Promise<number> {
  const db = openDb()
  const res = await db.query(
    'UPDATE cards SET deleted = 1 WHERE id = $1 AND deleted = 0',
    [id],
  )
  return res.rowCount ?? 0
}

export async function insertCardsMissing(
  pairs: ScrapedPair[],
): Promise<{ inserted: number; skipped: number; insertedIds: number[] }> {
  const db = openDb()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const maxRes = await client.query<{ max_id: number }>(
      'SELECT COALESCE(MAX(id), 0)::int AS max_id FROM cards',
    )
    let nextId = maxRes.rows[0].max_id + 1
    let inserted = 0
    let skipped = 0
    const insertedIds: number[] = []
    for (const row of pairs) {
      const existsRes = await client.query(
        'SELECT 1 FROM cards WHERE source_text = $1',
        [row.source_text],
      )
      if ((existsRes.rowCount ?? 0) > 0) {
        skipped++
        continue
      }
      await client.query(
        'INSERT INTO cards (id, source_text, target_text, examples_html) VALUES ($1, $2, $3, NULL)',
        [nextId, row.source_text, row.target_text],
      )
      insertedIds.push(nextId)
      nextId++
      inserted++
    }
    await client.query('COMMIT')
    return { inserted, skipped, insertedIds }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function listCardsWithoutExamples(opts: {
  limit?: number
  ids?: number[]
} = {}): Promise<TranslationCard[]> {
  const db = openDb()
  if (opts.ids && opts.ids.length > 0) {
    const { rows } = await db.query<TranslationCard>(
      `SELECT ${CARD_COLS} FROM cards WHERE id = ANY($1::int[]) AND deleted = 0 ORDER BY id DESC`,
      [opts.ids],
    )
    return rows
  }
  if (opts.limit && opts.limit > 0) {
    const { rows } = await db.query<TranslationCard>(
      `SELECT ${CARD_COLS} FROM cards WHERE examples_html IS NULL AND deleted = 0 ORDER BY id DESC LIMIT $1`,
      [opts.limit],
    )
    return rows
  }
  const { rows } = await db.query<TranslationCard>(
    `SELECT ${CARD_COLS} FROM cards WHERE examples_html IS NULL AND deleted = 0 ORDER BY id DESC`,
  )
  return rows
}

export async function updateExamplesHtml(id: number, html: string): Promise<number> {
  const db = openDb()
  const res = await db.query('UPDATE cards SET examples_html = $1 WHERE id = $2', [html, id])
  return res.rowCount ?? 0
}

/** Find a non-deleted card whose source_text matches exactly. */
export async function findCardBySourceText(sourceText: string): Promise<TranslationCard | null> {
  const db = openDb()
  const { rows } = await db.query<TranslationCard>(
    `SELECT ${CARD_COLS} FROM cards WHERE source_text = $1 AND deleted = 0`,
    [sourceText],
  )
  return rows[0] ?? null
}

/**
 * Replace a card's source_text + target_text and clear examples_html so the
 * card is ready for re-enrichment. Returns the number of rows updated (0 if
 * the id is missing or already deleted).
 */
export async function replaceCardContent(
  id: number,
  sourceText: string,
  targetText: string,
): Promise<number> {
  const db = openDb()
  const res = await db.query(
    `UPDATE cards
     SET source_text = $1, target_text = $2, examples_html = NULL
     WHERE id = $3 AND deleted = 0`,
    [sourceText, targetText, id],
  )
  return res.rowCount ?? 0
}

// ─── Learning ────────────────────────────────────────────────────────────────

/**
 * Starts learning a card. Days is 1 if the server clock is already past today's
 * morning cron (9:00 Europe/Berlin), otherwise 2 — so the user never gets a
 * same-day notification.
 */
export async function startLearning(id: number, days: number): Promise<number> {
  const db = openDb()
  const res = await db.query(
    `UPDATE cards SET learning_status = 'short', learning_days_remaining = $1
     WHERE id = $2 AND deleted = 0`,
    [days, id],
  )
  return res.rowCount ?? 0
}

export async function resetLearning(id: number): Promise<number> {
  const db = openDb()
  const res = await db.query(
    `UPDATE cards SET learning_status = NULL, learning_days_remaining = NULL
     WHERE id = $1 AND deleted = 0`,
    [id],
  )
  return res.rowCount ?? 0
}

/** Cards in a given learning status that are due today (days=0). */
export async function listLearningReady(status: 'short' | 'long'): Promise<TranslationCard[]> {
  const db = openDb()
  const { rows } = await db.query<TranslationCard>(
    `SELECT ${CARD_COLS} FROM cards
     WHERE learning_status = $1 AND learning_days_remaining = 0 AND deleted = 0
     ORDER BY id DESC`,
    [status],
  )
  return rows
}

/** 9 AM morning job, step 1: decrement every active countdown by 1 (floor at 0). */
export async function decrementCountdowns(): Promise<number> {
  const db = openDb()
  const res = await db.query(
    `UPDATE cards
     SET learning_days_remaining = learning_days_remaining - 1
     WHERE learning_days_remaining > 0
       AND learning_status IS NOT NULL
       AND deleted = 0`,
  )
  return res.rowCount ?? 0
}

/** Cards ready to notify (days=0) grouped by status. */
export async function listReadyToNotify(): Promise<{ short: number; long: number }> {
  const db = openDb()
  const { rows } = await db.query<{ status: 'short' | 'long'; n: string }>(
    `SELECT learning_status AS status, COUNT(*) AS n FROM cards
     WHERE learning_days_remaining = 0 AND learning_status IS NOT NULL AND deleted = 0
     GROUP BY learning_status`,
  )
  const out = { short: 0, long: 0 }
  for (const r of rows) out[r.status] = Number(r.n)
  return out
}

/** 11 PM evening job: transition short→long (7 days) and long→null (cleared). */
export async function transitionReady(): Promise<{ shortToLong: number; longToNull: number }> {
  const db = openDb()
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const s = await client.query(
      `UPDATE cards
       SET learning_status = 'long', learning_days_remaining = 7
       WHERE learning_status = 'short' AND learning_days_remaining = 0 AND deleted = 0`,
    )
    const l = await client.query(
      `UPDATE cards
       SET learning_status = NULL, learning_days_remaining = NULL
       WHERE learning_status = 'long' AND learning_days_remaining = 0 AND deleted = 0`,
    )
    await client.query('COMMIT')
    return { shortToLong: s.rowCount ?? 0, longToNull: l.rowCount ?? 0 }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Category ────────────────────────────────────────────────────────────────

/** Set or clear a card's category. Mutually exclusive — `null` clears. */
export async function setCategory(id: number, category: CardCategory): Promise<number> {
  const db = openDb()
  const res = await db.query(
    `UPDATE cards SET category = $1 WHERE id = $2 AND deleted = 0`,
    [category, id],
  )
  return res.rowCount ?? 0
}

/** List non-deleted cards with the given category. */
export async function listByCategory(
  category: 'ausdruck' | 'favorite',
): Promise<TranslationCard[]> {
  const db = openDb()
  const { rows } = await db.query<TranslationCard>(
    `SELECT ${CARD_COLS} FROM cards
     WHERE category = $1 AND deleted = 0
     ORDER BY id DESC`,
    [category],
  )
  return rows
}

// ─── Push subscriptions ──────────────────────────────────────────────────────

export async function upsertPushSubscription(sub: PushSubscriptionRow): Promise<void> {
  const db = openDb()
  await db.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth)
     VALUES ($1, $2, $3)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    [sub.endpoint, sub.p256dh, sub.auth],
  )
}

export async function removePushSubscription(endpoint: string): Promise<number> {
  const db = openDb()
  const res = await db.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint])
  return res.rowCount ?? 0
}

export async function listPushSubscriptions(): Promise<PushSubscriptionRow[]> {
  const db = openDb()
  const { rows } = await db.query<PushSubscriptionRow>(
    'SELECT endpoint, p256dh, auth FROM push_subscriptions',
  )
  return rows
}

export function getDbUrl(): string {
  return DATABASE_URL!.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@')
}
