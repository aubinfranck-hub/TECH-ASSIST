import { api } from './api.js';

/**
 * Notifications du téléphone ou de l'ordinateur du technicien (standard Web Push) : rien à installer, mais le navigateur
 * doit les permettre. Sur iPhone, il faut d'abord « Ajouter à l'écran d'accueil ».
 */
export type PushSupport = 'ok' | 'ios-install' | 'unsupported';

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (capable) return 'ok';
  return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
}

function keyBytes(base64Url: string): Uint8Array {
  const padded = base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** Cet appareil reçoit-il déjà les alertes ? */
export async function deviceSubscribed(): Promise<boolean> {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return !!(await reg?.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export class PushError extends Error {}

/** Demande l'autorisation, abonne l'appareil et l'enregistre sur le serveur. */
export async function enablePush(publicKey: string): Promise<void> {
  if (pushSupport() !== 'ok') throw new PushError("Ce navigateur ne permet pas les notifications.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PushError("Les notifications sont bloquées. Autorisez-les dans les réglages du navigateur pour ce site, puis réessayez.");
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource };
  let sub = await reg.pushManager.getSubscription();
  // Abonnement fait avec une autre clé du serveur : il ne recevrait plus rien, on le refait.
  const old = sub?.options.applicationServerKey;
  if (sub && old && !sameBytes(new Uint8Array(old), keyBytes(publicKey))) {
    await sub.unsubscribe().catch(() => undefined);
    sub = null;
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe(options);
    } catch {
      throw new PushError("Ce navigateur n'a pas pu s'abonner aux notifications (service de notification injoignable). Vérifiez la connexion Internet, ou essayez avec Chrome.");
    }
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new PushError("L'abonnement aux notifications est incomplet.");
  try {
    await api.post('/api/technician/push/subscribe', { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
  } catch (err) {
    // Clé du serveur changée depuis le dernier abonnement : on repart d'un abonnement neuf.
    await sub.unsubscribe().catch(() => undefined);
    throw err;
  }
}

/** Coupe les alertes de cet appareil. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post('/api/technician/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
