import 'dotenv/config'
import express from 'express'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  deleteCardById,
  findCardBySourceText,
  getCardById,
  getDbUrl,
  listCards,
  listLearningReady,
  openDb,
  removePushSubscription,
  replaceCardContent,
  resetLearning,
  startLearning,
  upsertPushSubscription,
} from './db.js'
import { enrichCardById, translateToRussian } from './enrich.js'
import { sendReviewPush } from './push.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3001)
const IS_PROD = process.env.NODE_ENV === 'production'

openDb()
console.error(`DB: ${getDbUrl()}`)

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? ''

const app = express()
app.use(express.json())

app.get('/api/cards', async (_req, res) => {
  res.json(await listCards())
})

app.delete('/api/cards/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  const changes = await deleteCardById(id)
  if (changes === 0) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.status(204).end()
})

// ─── Learning ────────────────────────────────────────────────────────────────

/**
 * Computes starting days based on server time (Europe/Berlin). If the morning
 * 9:00 cron hasn't yet run today, start at 2 so that today's cron doesn't
 * immediately decrement to 0 and notify on the click day.
 */
function startingDays(now = new Date()): number {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    hour: 'numeric',
    hour12: false,
  }).format(now)
  const hour = Number(hourStr)
  return hour < 9 ? 2 : 1
}

app.post('/api/cards/:id/learning', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  const days = startingDays()
  const changes = await startLearning(id, days)
  if (changes === 0) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json({ learning_status: 'short', learning_days_remaining: days })
})

app.post('/api/cards/:id/regenerate', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  if (!(await getCardById(id))) {
    res.status(404).json({ error: 'not found' })
    return
  }
  try {
    const { card, result } = await enrichCardById(id)
    if (result.skipped) {
      res.status(503).json({ error: 'enrichment unavailable (OPENAI_API_KEY not set)' })
      return
    }
    if (!card) {
      res.status(500).json({ error: 'enrichment failed', failed: result.failed })
      return
    }
    res.json(card)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'regenerate failed', message: (err as Error).message })
  }
})

app.post('/api/cards/:id/replace', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  const body = req.body as { text?: unknown }
  const rawText = typeof body?.text === 'string' ? body.text : ''
  const text = rawText.trim().replace(/\s+/g, ' ')
  if (!text) {
    res.status(400).json({ error: 'text required' })
    return
  }
  if (text.length > 200) {
    res.status(400).json({ error: 'text too long (max 200 chars)' })
    return
  }

  const existing = await getCardById(id)
  if (!existing) {
    res.status(404).json({ error: 'not found' })
    return
  }
  if (text === existing.source_text) {
    res.json(existing)
    return
  }
  const dup = await findCardBySourceText(text)
  if (dup && dup.id !== id) {
    res.status(409).json({ error: 'duplicate', existingId: dup.id })
    return
  }

  let target: string | null
  try {
    target = await translateToRussian(text)
  } catch (err) {
    console.error('translate failed:', err)
    res.status(502).json({ error: 'translation failed', message: (err as Error).message })
    return
  }
  if (target === null) {
    res.status(503).json({ error: 'translation unavailable (OPENAI_API_KEY not set)' })
    return
  }

  const changes = await replaceCardContent(id, text, target)
  if (changes === 0) {
    res.status(404).json({ error: 'not found' })
    return
  }

  try {
    const { card, result } = await enrichCardById(id)
    if (result.skipped || !card) {
      const fresh = await getCardById(id)
      res.json(fresh)
      return
    }
    res.json(card)
  } catch (err) {
    console.error('enrich after replace failed:', err)
    const fresh = await getCardById(id)
    res.json(fresh)
  }
})

app.delete('/api/cards/:id/learning', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  const changes = await resetLearning(id)
  if (changes === 0) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json({ learning_status: null, learning_days_remaining: null })
})

app.get('/api/cards/learning', async (req, res) => {
  const status = req.query.status
  if (status !== 'short' && status !== 'long') {
    res.status(400).json({ error: 'status must be short or long' })
    return
  }
  res.json(await listLearningReady(status))
})

// ─── Push subscriptions ──────────────────────────────────────────────────────

app.get('/api/push/vapid-public-key', (_req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    res.status(503).json({ error: 'VAPID not configured' })
    return
  }
  res.json({ key: VAPID_PUBLIC_KEY })
})

app.post('/api/push/subscribe', async (req, res) => {
  const body = req.body as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    res.status(400).json({ error: 'invalid subscription payload' })
    return
  }
  await upsertPushSubscription({
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  })
  res.status(204).end()
})

app.post('/api/push/unsubscribe', async (req, res) => {
  const body = req.body as { endpoint?: string }
  if (!body?.endpoint) {
    res.status(400).json({ error: 'endpoint required' })
    return
  }
  await removePushSubscription(body.endpoint)
  res.status(204).end()
})

// ─── Admin ───────────────────────────────────────────────────────────────────
// WARNING: unauthenticated. Protect /api/admin/* at the reverse proxy if
// deploying to a public network.

app.post('/api/admin/notify', async (_req, res) => {
  try {
    const result = await sendReviewPush()
    res.json(result)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'failed to send', message: (err as Error).message })
  }
})

// ─── Static SPA in prod ──────────────────────────────────────────────────────

if (IS_PROD) {
  const distDir = resolve(__dirname, '../../dist')
  app.use(express.static(distDir))
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(resolve(distDir, 'index.html'))
  })
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'internal error' })
})

app.listen(PORT, () => {
  console.error(`Listening on :${PORT} (NODE_ENV=${process.env.NODE_ENV ?? 'development'})`)
})
