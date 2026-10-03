import { pool } from '../db/pool.js';
import type { Db } from './audit.js';

/**
 * Offres (D14) :
 *  - 500 FCFA   « Assistance IA »            : l'agent IA seul, sans technicien humain ;
 *  - 2 000 FCFA « Assistance IA + technicien » : l'agent d'abord, un technicien prend le relais si besoin ;
 *  - entreprise : forfaits selon le nombre de postes, IA et technicien toujours inclus.
 * La règle est appliquée ICI, côté serveur : l'agent et le site ne font que l'annoncer.
 */

/** Lancement gratuit : tant que FREE_LAUNCH=true, toute assistance est offerte et un technicien reste disponible pour tous. */
export function freeLaunch(): boolean {
  return process.env.FREE_LAUNCH === 'true';
}

/** Un technicien fait-il partie de ce forfait ? Absent = oui (offerte, abonné, société, formules historiques). */
export function humanIncludedFor(planMetadata: Record<string, unknown> | null | undefined): boolean {
  return freeLaunch() || planMetadata?.humanIncluded !== false;
}

export const UPGRADE_PLAN_ID = 'complement_technicien';

export interface UpgradeOffer {
  planId: string;
  priceFcfa: number;
}

/** Complément à payer pour ajouter un technicien à une assistance « IA seule » (lu en base : modifiable en admin). */
export async function upgradeOffer(db: Db = pool): Promise<UpgradeOffer | null> {
  const { rows } = await db.query('SELECT id, price_fcfa FROM pricing_plans WHERE id = $1 AND active = TRUE', [UPGRADE_PLAN_ID]);
  return rows[0] ? { planId: rows[0].id as string, priceFcfa: Number(rows[0].price_fcfa) } : null;
}
