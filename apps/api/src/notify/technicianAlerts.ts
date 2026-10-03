import { pool } from '../db/pool.js';
import { logAudit } from '../utils/audit.js';
import { sendMail } from '../utils/mailer.js';
import { pushPublicKey, sendPush } from './push.js';

export interface AlertSummary {
  pushed: number;
  emailed: number;
  webhook: boolean;
  /** Techniciens de permanence prévenus (ou qui pouvaient l'être). */
  recipients: number;
}

function consoleUrl(sessionId: string): string {
  const base = (process.env.PUBLIC_WEB_URL ?? '').replace(/\/$/, '');
  return `${base}/technicien?session=${sessionId}`;
}

function envEmails(): string[] {
  return (process.env.TECH_ALERT_EMAILS ?? '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

async function postWebhook(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Un client demande un technicien : tous les techniciens de permanence sont prévenus, par tous les moyens configurés
 * (notification du téléphone, email, webhook). Une seule alerte par demande. Ne lève jamais d'erreur : l'alerte est un
 * plus, la demande du client est déjà enregistrée.
 */
export async function alertTechnicians(sessionId: string, reason?: string): Promise<AlertSummary | null> {
  try {
    // Réserve l'alerte : une seule fois par demande, même si l'agent et le bouton la signalent ensemble.
    const marked = await pool.query(
      `UPDATE sessions SET human_requested_at = now()
       WHERE id = $1 AND human_requested_at IS NULL AND status IN ('created','waiting_technician','active') AND technician_id IS NULL
       RETURNING id, session_code, platform, order_id`,
      [sessionId],
    );
    const session = marked.rows[0];
    if (!session) return null;

    const client = (await pool.query('SELECT client_name, client_phone FROM orders WHERE id = $1', [session.order_id])).rows[0] as
      | { client_name: string | null; client_phone: string }
      | undefined;

    const techs = (await pool.query(`SELECT id, full_name, alert_email FROM technicians WHERE is_active AND on_duty`)).rows as {
      id: string;
      full_name: string;
      alert_email: string | null;
    }[];
    const subs = techs.length
      ? ((
          await pool.query(
            `SELECT id, endpoint, p256dh, auth FROM technician_push_subscriptions WHERE technician_id = ANY($1::uuid[])`,
            [techs.map((t) => t.id)],
          )
        ).rows as { id: string; endpoint: string; p256dh: string; auth: string }[])
      : [];

    const who = client?.client_name?.trim() || 'Un client';
    const url = consoleUrl(session.id);
    const short = reason ? reason.slice(0, 140) : 'Le client demande un technicien.';
    const payload = { title: 'Un client demande un technicien', body: `${who} · ${session.platform === 'android' ? 'Android' : 'Windows'} — ${short}`, url };

    let pushed = 0;
    const gone: string[] = [];
    if (pushPublicKey()) {
      const results = await Promise.all(subs.map((s) => sendPush(s, payload)));
      results.forEach((r, i) => {
        if (r === 'sent') pushed++;
        else if (r === 'gone') gone.push(subs[i]!.id);
      });
      if (gone.length) await pool.query('DELETE FROM technician_push_subscriptions WHERE id = ANY($1::uuid[])', [gone]);
    }

    const emails = [...new Set([...techs.map((t) => t.alert_email?.toLowerCase()).filter((e): e is string => !!e), ...envEmails()])];
    const mailText =
      `${who} demande un technicien (Tech Assist, ${session.platform}).\n` +
      `${short}\n\nOuvrez la demande, vous verrez ce que l'agent a constaté et fait :\n${url}\n\n` +
      `Pour ne plus recevoir ces alertes, passez « hors permanence » dans votre console.`;
    const sent = await Promise.allSettled(emails.map((to) => sendMail({ to, subject: 'Tech Assist : un client demande un technicien', text: mailText })));
    const emailed = sent.filter((r) => r.status === 'fulfilled').length;

    const hook = process.env.ALERT_WEBHOOK_URL;
    const webhook = hook ? await postWebhook(hook, { text: `${payload.title} — ${payload.body}\n${url}`, ...payload, sessionId: session.id }) : false;

    const summary: AlertSummary = { pushed, emailed, webhook, recipients: techs.length };
    await logAudit(pool, { actorType: 'system', sessionId: session.id, action: 'technicians.alerted', details: { ...summary } });
    return summary;
  } catch (err) {
    console.error("[alertes] échec de l'alerte aux techniciens :", err instanceof Error ? err.message : err);
    return null;
  }
}

const inFlight = new Set<Promise<unknown>>();

/** Alerte sans faire attendre la requête du client ; `flushAlerts()` permet aux tests d'attendre la fin. */
export function inBackground(work: Promise<unknown>): void {
  const p: Promise<unknown> = work.finally(() => inFlight.delete(p));
  inFlight.add(p);
}

export function alertInBackground(sessionId: string, reason?: string): void {
  inBackground(alertTechnicians(sessionId, reason));
}

export async function flushAlerts(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

const lastClientPing = new Map<string, number>();

/** Le client écrit au technicien qui a pris sa demande : une notification discrète sur son téléphone (au plus une par 20 s). */
export async function pingAssignedTechnician(sessionId: string, technicianId: string, text: string): Promise<void> {
  const now = Date.now();
  if (now - (lastClientPing.get(sessionId) ?? 0) < 20_000) return;
  lastClientPing.set(sessionId, now);
  try {
    const subs = (await pool.query('SELECT id, endpoint, p256dh, auth FROM technician_push_subscriptions WHERE technician_id = $1', [technicianId])).rows as {
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    const payload = { title: 'Le client vous a répondu', body: text.slice(0, 120), url: consoleUrl(sessionId) };
    const results = await Promise.all(subs.map((s) => sendPush(s, payload)));
    const gone = subs.filter((_, i) => results[i] === 'gone').map((s) => s.id);
    if (gone.length) await pool.query('DELETE FROM technician_push_subscriptions WHERE id = ANY($1::uuid[])', [gone]);
  } catch {
    /* sans importance : le technicien verra le message en ouvrant la console */
  }
}
