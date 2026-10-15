import { spawn } from 'child_process'
import { resolve } from 'path'

/**
 * Runs the hourly scrape job (scripts/scrape-public-collection-by-link.mjs)
 * on demand, exactly as the deutsch-uben-scrape systemd timer does: scrape
 * the configured Yandex collection URLs, insert new cards, start them
 * learning, then enrich every card missing examples.
 *
 * The script is spawned as a child process rather than imported because it
 * is an .mjs that imports TypeScript sources directly (via tsx), and because
 * it drives a headless Chromium — keeping that out of the API process means
 * a crashed browser can't take the server down with it.
 *
 * Only one run at a time: the script assigns ids as MAX(id)+1, so two
 * concurrent runs could collide.
 */

export type ScrapeStatus = 'idle' | 'running' | 'done' | 'error'

export type ScrapeCollection = {
  id: string
  /** Collection name as shown in Yandex Translate. */
  name: string
  /** Records the collection currently holds. */
  count: number
  inserted: number
  readded: number
  /** Set when this collection could not be fetched. */
  error: string | null
}

export type ScrapeState = {
  status: ScrapeStatus
  startedAt: string | null
  finishedAt: string | null
  /** Brand-new cards inserted by the last run (from the script's SUMMARY line). */
  inserted: number | null
  /** Cards that were re-added to a collection and so re-inserted with a new id. */
  readded: number | null
  /** Cards enriched with AI examples by the last run. */
  enriched: number | null
  enrichFailed: number | null
  /** Per-collection breakdown, in configured order. */
  collections: ScrapeCollection[]
  /** Human-readable reason when status is 'error'. */
  error: string | null
  /** Tail of the script's log output, newest last. */
  log: string[]
}

const SCRIPT = 'scripts/scrape-public-collection-by-link.mjs'
const LOG_TAIL = 60

function emptyState(status: ScrapeStatus): ScrapeState {
  return {
    status,
    startedAt: null,
    finishedAt: null,
    inserted: null,
    readded: null,
    enriched: null,
    enrichFailed: null,
    collections: [],
    error: null,
    log: [],
  }
}

let state: ScrapeState = emptyState('idle')

export function getScrapeState(): ScrapeState {
  return state
}

function pushLog(line: string) {
  const trimmed = line.trimEnd()
  if (!trimmed) return
  state.log.push(trimmed)
  if (state.log.length > LOG_TAIL) state.log.splice(0, state.log.length - LOG_TAIL)

  // The script's last line is `SUMMARY <json>`; lift the numbers out so
  // the UI can say "+3 cards" without parsing logs itself.
  const summary = /^SUMMARY (\{.*\})$/.exec(trimmed)
  if (!summary) return
  try {
    const j = JSON.parse(summary[1]) as {
      collections?: ScrapeCollection[]
      inserted?: number
      readded?: number
      enriched?: number | null
      enrichFailed?: number | null
    }
    state.inserted = j.inserted ?? null
    state.readded = j.readded ?? null
    state.enriched = j.enriched ?? null
    state.enrichFailed = j.enrichFailed ?? null
    state.collections = Array.isArray(j.collections) ? j.collections : []
  } catch (err) {
    console.error(`[scrape] could not parse summary line: ${(err as Error).message}`)
  }
}

/**
 * Start a scrape run. Returns false (and does nothing) if one is already
 * in progress.
 */
export function startScrape(): boolean {
  if (state.status === 'running') return false

  state = emptyState('running')
  state.startedAt = new Date().toISOString()

  // Run through tsx's CLI with the same node binary that runs the server,
  // so the script's `.ts` imports resolve whether we're in dev (tsx watch)
  // or prod (compiled dist-server under plain node). cwd is the repo root
  // in both cases (the systemd unit sets WorkingDirectory).
  const tsxCli = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
  const child = spawn(process.execPath, [tsxCli, SCRIPT], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      pushLog(line)
      console.error(`[scrape] ${line}`)
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)

  child.on('error', (err) => {
    state.status = 'error'
    state.error = `could not start scrape: ${err.message}`
    state.finishedAt = new Date().toISOString()
  })

  child.on('close', (code, signal) => {
    if (state.status !== 'running') return
    state.finishedAt = new Date().toISOString()
    if (code === 0) {
      state.status = 'done'
    } else if (state.collections.length > 0 && state.collections.some((c) => !c.error)) {
      // The script exits 1 when any collection failed, but it still synced
      // the others and printed a summary. Surface that as a partial
      // success rather than a failed run: the per-collection errors are
      // in `collections` for the UI to show.
      state.status = 'done'
    } else {
      state.status = 'error'
      // The script's own last error line is more useful than the exit code.
      const lastError = [...state.log].reverse().find((l) => /error|fatal/i.test(l))
      state.error =
        lastError?.trim() ??
        (signal ? `scrape killed by ${signal}` : `scrape exited with code ${code}`)
    }
  })

  return true
}
