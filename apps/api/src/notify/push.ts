import webpush from 'web-push';

/**
 * Notifications sur le téléphone ou l'ordinateur du technicien (standard « Web Push », sans application à installer).
 * Clés : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:…). Sans clés, les alertes passent par email et webhook.
 */
export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? process.env.VAPID_PUBLIC_KEY : null;
}

export type PushResult = 'sent' | 'gone' | 'failed';

/** « gone » : l'appareil ne reçoit plus rien (désinscrit) : l'abonnement doit être supprimé. */
export async function sendPush(sub: PushSubscriptionRow, payload: PushPayload): Promise<PushResult> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return 'failed';
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
      vapidDetails: { subject: process.env.VAPID_SUBJECT ?? 'mailto:contact@tech-assist.example', publicKey, privateKey },
      TTL: 60 * 60,
      urgency: 'high',
      timeout: 8000,
    });
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'failed';
  }
}
