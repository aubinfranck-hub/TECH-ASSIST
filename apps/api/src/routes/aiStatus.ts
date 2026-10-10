import { Router } from 'express';
import { callProvider, modelFor, chatChain, ProviderError, type ProviderName } from '../learning/providers.js';

/**
 * État réel des IA branchées sur le serveur (DeepSeek, Gemini, Claude) : pour chacune, la clé est-elle présente et répond-elle ?
 * Un petit essai est fait au plus toutes les 10 minutes. Aucune clé, aucun contenu : seulement des noms et une raison courte.
 */
export interface ProviderState {
  provider: ProviderName;
  model: string;
  ok: boolean;
  reason?: string;
}

let cache: { at: number; states: ProviderState[] } | null = null;
const TTL_MS = 10 * 60_000;

function reasonOf(err: unknown): string {
  const message = err instanceof ProviderError ? err.message : '';
  if (/40[12]/.test(message)) return 'clé refusée ou crédit épuisé';
  if (/403/.test(message)) return 'accès refusé à cette clé';
  if (/429/.test(message)) return 'trop de demandes (quota)';
  if (/délai|timeout|abort/i.test(message)) return 'délai dépassé';
  return 'ne répond pas';
}

export async function aiStatus(force = false): Promise<ProviderState[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.states;
  const states = await Promise.all(
    chatChain().map(async (provider): Promise<ProviderState> => {
      const model = modelFor(provider);
      try {
        await callProvider(provider, { system: 'Réponds par un objet JSON : {"ok": true}', user: 'Réponds en JSON.', timeoutMs: 12_000 });
        return { provider, model, ok: true };
      } catch (err) {
        return { provider, model, ok: false, reason: reasonOf(err) };
      }
    }),
  );
  cache = { at: Date.now(), states };
  return states;
}

export const aiStatusRouter = Router();

aiStatusRouter.get('/ai/status', async (_req, res) => {
  const states = await aiStatus();
  res.json({ providers: states, available: states.some((s) => s.ok), none_configured: states.length === 0 });
});
