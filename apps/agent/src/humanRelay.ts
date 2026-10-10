import type { RelayPoll } from './appAccount.js';
import type { ConversationUi } from './types.js';

/**
 * Après un passage de main, la fenêtre reste ouverte : le client y lit les messages du technicien et lui répond.
 * L'agent interroge le serveur toutes les quelques secondes ; le technicien est prévenu sur son téléphone dès la demande.
 */
export interface RelayApi {
  relayPoll(token: string, sessionId: string, after: number): Promise<RelayPoll>;
  relaySend(token: string, sessionId: string, body: string): Promise<unknown>;
}

export interface RelayDeps {
  ui: ConversationUi;
  api: RelayApi;
  token: string;
  sessionId: string;
  /** Intervalle entre deux interrogations du serveur (tests : très court). */
  pollMs?: number;
  /** Au bout de ce délai sans prise en charge, on rassure le client (une seule fois). */
  waitNoticeMs?: number;
  /** Nombre d'échecs de connexion d'affilée avant de renoncer. */
  maxFailures?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export type RelayEnd = 'finished' | 'closed' | 'unreachable';

const FINAL_STATUSES = new Set(['completed', 'expired', 'cancelled']);
const PROMPT = 'Écrivez à votre technicien :';

export const RELAY_INTRO =
  "Un technicien a été prévenu sur son téléphone. Gardez cette fenêtre ouverte : sa réponse s'affichera ici, et vous pouvez lui écrire ci-dessous. Si vous la fermez, il pourra vous appeler au numéro que vous avez donné.";

export const RELAY_WAITING =
  "Aucun technicien n'a encore répondu. Ce n'est pas oublié : la demande reste en tête de liste. Gardez cette fenêtre ouverte ; vous pouvez aussi la fermer, un technicien vous appellera.";

export async function relayWithTechnician(deps: RelayDeps): Promise<RelayEnd> {
  const { ui, api, token, sessionId } = deps;
  const pollMs = deps.pollMs ?? 3000;
  const waitNoticeMs = deps.waitNoticeMs ?? 10 * 60_000;
  const maxFailures = deps.maxFailures ?? 20;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const started = now();

  ui.info(RELAY_INTRO);
  let after = 0;
  let failures = 0;
  let waitingNoticeShown = false;
  let claimed = false;
  const ask = () => ui.ask(PROMPT);
  let asking = ask();

  for (;;) {
    try {
      const poll = await api.relayPoll(token, sessionId, after);
      failures = 0;
      for (const m of poll.messages) {
        after = Math.max(after, m.id);
        if (m.sender === 'technician') {
          if (ui.fromTechnician) ui.fromTechnician(m.name ?? 'Technicien', m.body);
          else ui.info(`${m.name ?? 'Le technicien'} : ${m.body}`);
        } else if (m.sender === 'system') {
          ui.info(m.body);
        }
      }
      claimed = poll.state.claimed;
      if (FINAL_STATUSES.has(poll.state.status)) {
        ui.info("L'assistance est terminée. Merci de votre confiance !");
        return 'finished';
      }
      if (!claimed && !waitingNoticeShown && now() - started >= waitNoticeMs) {
        waitingNoticeShown = true;
        ui.info(RELAY_WAITING);
      }
    } catch {
      failures += 1;
      if (failures >= maxFailures) {
        ui.info("Je n'arrive plus à joindre Tech Assist (connexion Internet ?). Votre demande reste enregistrée : un technicien vous appellera.");
        return 'unreachable';
      }
    }

    const winner = await Promise.race([asking.then((value) => ({ value })), sleep(pollMs).then(() => null)]);
    if (winner) {
      if (winner.value === null) return 'closed'; // fenêtre fermée
      try {
        await api.relaySend(token, sessionId, winner.value);
      } catch (err) {
        ui.info(`Votre message n'a pas pu être envoyé${err instanceof Error && err.message ? ` (${err.message})` : ''}. Réessayez.`);
      }
      asking = ask();
    }
  }
}
