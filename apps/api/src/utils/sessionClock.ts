import { pool } from '../db/pool.js';
import { creditEarningSafely } from '../partners/earnings.js';
import { logAudit, type Db } from './audit.js';
import { freeLaunch } from './offers.js';

/** Temps minimal laissé à un technicien qui prend le relais de l'agent IA, même si l'horloge du forfait est déjà avancée. */
export const HUMAN_MIN_MINUTES = 10;

/**
 * Fin des minutes du forfait : une assistance qui a dépassé son heure de fin est terminée côté serveur
 * (mot de passe de connexion effacé, gain du technicien crédité). Sans effet pendant le lancement gratuit
 * (aucune limite de durée) et sur les sessions partenaires, qui ont leur propre règle (D16).
 * Appelée à la volée par les routes de session et régulièrement par le serveur.
 */
export async function expireOverdueSessions(db: Db = pool): Promise<string[]> {
  if (freeLaunch()) return [];
  const { rows } = await db.query(
    `UPDATE sessions
     SET status = 'completed', stopped_at = now(), stopped_by = 'timeout', remote_password_encrypted = NULL
     WHERE kind = 'assistance' AND status IN ('created', 'waiting_technician', 'active')
       AND ends_at IS NOT NULL AND ends_at < now()
     RETURNING id`,
  );
  const ids = rows.map((r: { id: string }) => r.id);
  for (const id of ids) {
    await logAudit(db, { actorType: 'system', sessionId: id, action: 'session.timeout' });
    await creditEarningSafely(db, id);
  }
  return ids;
}
