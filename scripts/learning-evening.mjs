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
import { transitionReady, closeDb, getDbUrl } from '../server/db.ts'

async function main() {
  console.error(`DB: ${getDbUrl()}`)
  const { shortToLong, longToNull } = await transitionReady()
  console.error(`Transitions: short→long=${shortToLong}, long→done=${longToNull}`)
}

main()
  .catch((err) => {
    console.error('Fatal:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
