#!/usr/bin/env node

/**
 * Morning learning job (run at 09:00 Europe/Berlin).
 *
 * 1. Decrements every active `learning_days_remaining` by 1 (floor at 0).
 * 2. Counts cards that are now at days=0 grouped by status.
 * 3. Sends up to two web-push notifications (one per non-empty group).
 *
 * VPS cron (adjust path):
 *   0 9 * * *  cd /srv/deutsch-uben && TZ=Europe/Berlin /usr/bin/env npx tsx scripts/learning-morning.mjs >> /var/log/deutsch-uben-morning.log 2>&1
 */

import 'dotenv/config'
import webpush from 'web-push'
import {
  decrementCountdowns,
  listReadyToNotify,
  listPushSubscriptions,
  removePushSubscription,
  closeDb,
  getDbPath,
} from '../server/db.ts'

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:amatveev@devexperts.com'

function configureWebPush() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.error('VAPID keys not set — skipping notification delivery.')
    return false
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  return true
}

async function sendTo(sub, payload) {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
    )
    return { ok: true }
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      // Subscription expired — clean up.
      removePushSubscription(sub.endpoint)
      return { ok: false, gone: true }
    }
    return { ok: false, error: err?.message ?? String(err) }
  }
}

async function main() {
  console.error(`DB: ${getDbPath()}`)

  const decremented = decrementCountdowns()
  console.error(`Decremented ${decremented} countdown(s).`)

  const { short, long } = listReadyToNotify()
  console.error(`Ready now: short=${short}, long=${long}`)

  if (short === 0 && long === 0) {
    console.error('Nothing to notify.')
    return
  }

  const canPush = configureWebPush()
  if (!canPush) return

  const subs = listPushSubscriptions()
  if (subs.length === 0) {
    console.error('No push subscriptions registered.')
    return
  }
  console.error(`Delivering to ${subs.length} subscription(s).`)

  const payloads = []
  if (short > 0) {
    payloads.push({
      title: `${short} short review${short === 1 ? '' : 's'}`,
      body: 'Tap to review cards due today (short phase).',
      url: '/learning/short',
      tag: 'learning-short',
    })
  }
  if (long > 0) {
    payloads.push({
      title: `${long} long review${long === 1 ? '' : 's'}`,
      body: 'Tap to review cards due today (long phase).',
      url: '/learning/long',
      tag: 'learning-long',
    })
  }

  let sent = 0
  let failed = 0
  let expired = 0
  for (const sub of subs) {
    for (const payload of payloads) {
      const r = await sendTo(sub, payload)
      if (r.ok) sent++
      else if (r.gone) expired++
      else {
        failed++
        console.error(`  ✗ ${sub.endpoint.slice(0, 60)}…: ${r.error}`)
      }
    }
  }
  console.error(`Sent=${sent}, failed=${failed}, expired=${expired}`)
}

main()
  .catch((err) => {
    console.error('Fatal:', err)
    process.exitCode = 1
  })
  .finally(() => {
    closeDb()
  })
