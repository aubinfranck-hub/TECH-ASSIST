import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { broadcastPing, broadcastSnapshot, register, type WaitingRequest } from '../notify/technicianHub.js';

/**
 * GET /api/technician/stream : flux temps réel pour les applications technicien. Réservé aux techniciens ; l'application l'ouvre une fois et
 * reçoit au même instant, comme tous ses confrères, chaque nouvelle demande (voir notify/technicianHub.ts).
 */
export const technicianStreamRouter = Router();

export async function waitingQueue(): Promise<WaitingRequest[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.platform, COALESCE(s.human_requested_at, s.created_at) AS at, o.client_name
     FROM sessions s JOIN orders o ON o.id = s.order_id
     WHERE s.status IN ('created', 'waiting_technician') AND s.technician_id IS NULL AND s.mode = 'humain' AND s.human_included = TRUE
     ORDER BY s.created_at ASC LIMIT 50`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    platform: String(r.platform),
    who: (r.client_name as string | null)?.trim() || 'Un client',
    reason: 'Le client demande un technicien.',
    at: new Date(r.at as string).toISOString(),
  }));
}

const MAX_STREAMS_PER_TECHNICIAN = 5;
const open = new Map<string, Set<() => void>>();
let ticker: NodeJS.Timeout | null = null;
let ticks = 0;

function startTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    ticks++;
    broadcastPing();
    // Toutes les 30 s, la file complète : une coupure réseau ne fait jamais manquer une demande, ni garder une alerte périmée.
    if (ticks % 2 === 0) void waitingQueue().then(broadcastSnapshot).catch(() => undefined);
  }, 15_000);
  ticker.unref();
}

function stopTickerIfIdle(): void {
  if (ticker && [...open.values()].every((s) => s.size === 0)) {
    clearInterval(ticker);
    ticker = null;
  }
}

technicianStreamRouter.get('/technician/stream', requireAuth('technician', 'admin'), async (req, res) => {
  const technicianId = req.auth!.sub;
  const onDutyRow = await pool.query('SELECT on_duty FROM technicians WHERE id = $1', [technicianId]);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': ouvert\n\n');

  const conn = register(technicianId, res);
  const closers = open.get(technicianId) ?? new Set<() => void>();
  open.set(technicianId, closers);
  const close = () => {
    conn.remove();
    closers.delete(close);
    stopTickerIfIdle();
    if (!res.writableEnded) res.end();
  };
  closers.add(close);
  // Au-delà de 5 connexions pour un même technicien, les plus anciennes sont fermées (une application relancée n'en laisse pas d'orphelines).
  while (closers.size > MAX_STREAMS_PER_TECHNICIAN) {
    const oldest = closers.values().next().value as (() => void) | undefined;
    if (!oldest) break;
    oldest();
  }
  req.on('close', close);
  startTicker();

  conn.send({ type: 'hello', onDuty: Boolean(onDutyRow.rows[0]?.on_duty) });
  conn.send({ type: 'snapshot', queue: await waitingQueue().catch(() => []) });
});
