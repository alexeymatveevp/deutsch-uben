import 'dotenv/config'
import express from 'express'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  deleteCardById,
  getDbPath,
  listCards,
  openDb,
} from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT ?? 3001)
const IS_PROD = process.env.NODE_ENV === 'production'

openDb()
console.error(`DB: ${getDbPath()}`)

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
