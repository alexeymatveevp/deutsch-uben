#!/usr/bin/env node

/**
 * Morning learning job (run at 09:00 Europe/Berlin).
 *
 * 1. Decrements every active `learning_days_remaining` by 1 (floor at 0).
 * 2. Sends a combined push notification for cards now at days=0 (the
 *    actual push logic lives in server/push.ts and is shared with the
 *    admin "Send notification" endpoint).
 *
 * VPS cron (adjust path):
 *   0 9 * * *  cd /srv/deutsch-uben && TZ=Europe/Berlin /usr/bin/env npx tsx scripts/learning-morning.mjs >> /var/log/deutsch-uben-morning.log 2>&1
 */

import 'dotenv/config'
import { decrementCountdowns, closeDb, getDbPath } from '../server/db.ts'
import { sendReviewPush } from '../server/push.ts'

async function main() {
  console.error(`DB: ${getDbPath()}`)
  const decremented = decrementCountdowns()
  console.error(`Decremented ${decremented} countdown(s).`)

  const result = await sendReviewPush()
  if (result.skipped) {
    console.error('VAPID keys not set — skipping notification delivery.')
    return
  }
  console.error(`Ready now: short=${result.short}, long=${result.long}`)
  if (result.short === 0 && result.long === 0) {
    console.error('Nothing to notify.')
    return
  }
  console.error(`Sent=${result.sent}, failed=${result.failed}, expired=${result.expired}`)
}

main()
  .catch((err) => {
    console.error('Fatal:', err)
    process.exitCode = 1
  })
  .finally(() => {
    closeDb()
  })
