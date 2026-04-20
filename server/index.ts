import 'dotenv/config'
import express from 'express'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  deleteCardById,
  getDbPath,
  listCards,
  listLearningReady,
  openDb,
  removePushSubscription,
  resetLearning,
  startLearning,
  upsertPushSubscription,
} from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3001)
const IS_PROD = process.env.NODE_ENV === 'production'

openDb()
console.error(`DB: ${getDbPath()}`)

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? ''

const app = express()
app.use(express.json())

app.get('/api/cards', (_req, res) => {
  res.json(listCards())
})

app.delete('/api/cards/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  const changes = deleteCardById(id)
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

app.post('/api/cards/:id/learning', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  const days = startingDays()
  const changes = startLearning(id, days)
  if (changes === 0) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json({ learning_status: 'short', learning_days_remaining: days })
})

app.delete('/api/cards/:id/learning', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid id' })
    return
  }
  const changes = resetLearning(id)
  if (changes === 0) {
    res.status(404).json({ error: 'not found' })
    return
  }
  res.json({ learning_status: null, learning_days_remaining: null })
})

app.get('/api/cards/learning', (req, res) => {
  const status = req.query.status
  if (status !== 'short' && status !== 'long') {
    res.status(400).json({ error: 'status must be short or long' })
    return
  }
  res.json(listLearningReady(status))
})

// ─── Push subscriptions ──────────────────────────────────────────────────────

app.get('/api/push/vapid-public-key', (_req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    res.status(503).json({ error: 'VAPID not configured' })
    return
  }
  res.json({ key: VAPID_PUBLIC_KEY })
})

app.post('/api/push/subscribe', (req, res) => {
  const body = req.body as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    res.status(400).json({ error: 'invalid subscription payload' })
    return
  }
  upsertPushSubscription({
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  })
  res.status(204).end()
})

app.post('/api/push/unsubscribe', (req, res) => {
  const body = req.body as { endpoint?: string }
  if (!body?.endpoint) {
    res.status(400).json({ error: 'endpoint required' })
    return
  }
  removePushSubscription(body.endpoint)
  res.status(204).end()
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
