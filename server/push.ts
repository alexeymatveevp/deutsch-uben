import webpush from 'web-push'
import {
  listPushSubscriptions,
  listReadyToNotify,
  removePushSubscription,
} from './db.js'

export type ReviewPayload = {
  title: string
  body: string
  url: string
  tag: string
}

export type SendResult = {
  short: number
  long: number
  sent: number
  failed: number
  expired: number
  skipped: boolean
}

let configured = false

export function configureWebPush(): boolean {
  if (configured) return true
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:noreply@example.com'
  if (!pub || !priv) return false
  webpush.setVapidDetails(subject, pub, priv)
  configured = true
  return true
}

export function buildReviewPayload(short: number, long: number): ReviewPayload | null {
  if (short === 0 && long === 0) return null
  const bodyParts: string[] = []
  if (long > 0) bodyParts.push(`С прошлой недели: ${long}`)
  if (short > 0) bodyParts.push(`Вчерашние слова: ${short}`)
  return {
    title: 'Пора повторять',
    body: bodyParts.join(' · '),
    url: 'learning',
    tag: 'learning-review',
  }
}

/**
 * Reads the current "ready to notify" counts from the DB, builds the
 * morning-cron-equivalent notification payload, and pushes it to every
 * registered subscription. Used by both scripts/learning-morning.mjs and
 * the admin /api/admin/notify endpoint. No decrement / no state mutation.
 */
export async function sendReviewPush(): Promise<SendResult> {
  if (!configureWebPush()) {
    return { short: 0, long: 0, sent: 0, failed: 0, expired: 0, skipped: true }
  }
  const { short, long } = listReadyToNotify()
  const payload = buildReviewPayload(short, long)
  if (!payload) {
    return { short, long, sent: 0, failed: 0, expired: 0, skipped: false }
  }

  const subs = listPushSubscriptions()
  let sent = 0
  let failed = 0
  let expired = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      )
      sent++
    } catch (err) {
      const e = err as { statusCode?: number; message?: string }
      if (e.statusCode === 404 || e.statusCode === 410) {
        removePushSubscription(sub.endpoint)
        expired++
      } else {
        failed++
        console.error(`push failed to ${sub.endpoint.slice(0, 60)}…: ${e.message ?? String(err)}`)
      }
    }
  }
  return { short, long, sent, failed, expired, skipped: false }
}
