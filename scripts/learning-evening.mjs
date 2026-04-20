#!/usr/bin/env node

/**
 * Evening learning job (run at 23:00 Europe/Berlin).
 *
 * For cards at `learning_days_remaining = 0`:
 *   - status='short' → status='long', days=7
 *   - status='long'  → status=NULL, days=NULL  (learning complete)
 *
 * VPS cron (adjust path):
 *   0 23 * * *  cd /srv/deutsch-uben && TZ=Europe/Berlin /usr/bin/env npx tsx scripts/learning-evening.mjs >> /var/log/deutsch-uben-evening.log 2>&1
 */

import 'dotenv/config'
import { transitionReady, closeDb, getDbPath } from '../server/db.ts'

function main() {
  console.error(`DB: ${getDbPath()}`)
  const { shortToLong, longToNull } = transitionReady()
  console.error(`Transitions: short→long=${shortToLong}, long→done=${longToNull}`)
}

try {
  main()
} catch (err) {
  console.error('Fatal:', err)
  process.exitCode = 1
} finally {
  closeDb()
}
