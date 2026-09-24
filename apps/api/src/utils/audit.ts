import type { Pool } from 'pg';

export type ActorType = 'client' | 'technician' | 'admin' | 'system';

interface AuditParams {
  actorType: ActorType;
  actorId?: string | null;
  sessionId?: string | null;
  orderId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}

/** RS-06 : journal d'audit signé pour chaque action sensible (qui, quand, quoi). */
export async function logAudit(pool: Pool, params: AuditParams): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (actor_type, actor_id, session_id, order_id, action, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.actorType,
      params.actorId ?? null,
      params.sessionId ?? null,
      params.orderId ?? null,
      params.action,
      JSON.stringify(params.details ?? {}),
    ],
  );
}
