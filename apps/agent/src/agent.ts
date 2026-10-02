import type { Action, AgentEvent, CommandRunner, Diagnosis, Reporter, Skill, Ui } from './types.js';

export type Outcome =
  | { status: 'fixed'; actionsDone: string[] }
  | { status: 'declined'; actionsDone: string[] }
  /** `recorded` : false si le serveur n'a pas pu enregistrer le passage de main (le client en est prévenu). */
  | { status: 'escalated'; reason: string; actionsDone: string[]; recorded: boolean };

/** Nombre maximal de tours « corriger puis relire » : un nouveau problème peut apparaître une fois un autre réglé. */
const MAX_ROUNDS = 3;
/** Limite du serveur sur le texte d'un événement ; au-delà, l'événement serait refusé et le passage de main perdu. */
const MAX_MESSAGE_LENGTH = 500;

export interface AgentContext {
  runner: CommandRunner;
  ui: Ui;
  reporter: Reporter;
}

/**
 * Boucle de l'agent : observer → proposer → (accord du client) → agir → vérifier.
 *
 * Garanties :
 * - la lecture de l'état est seule autorisée sans accord ; toute modification est
 *   proposée avec une explication, et ne part que sur un « oui » explicite ;
 * - seules les actions de la compétence (liste blanche) peuvent s'exécuter ;
 * - chaque étape est rapportée (journal côté serveur et console locale) ;
 * - quand l'agent n'y arrive pas, il passe la main à un technicien au lieu d'insister.
 */
export async function runSkill(skill: Skill, ctx: AgentContext): Promise<Outcome> {
  const done: string[] = [];
  const report = (event: Omit<AgentEvent, 'skill'>) =>
    safeReport(ctx.reporter, { ...event, skill: skill.id, message: truncate(event.message) });

  let diagnosis: Diagnosis;
  try {
    diagnosis = await skill.diagnose(ctx.runner);
  } catch (err) {
    const reason = `Diagnostic impossible : ${err instanceof Error ? err.message : String(err)}`;
    return escalate(ctx, report, done, reason, "Je n'arrive pas à analyser votre appareil.");
  }

  await report({ type: 'diagnosed', message: diagnosis.summary, details: { problems: diagnosis.problems } });
  ctx.ui.info(diagnosis.summary);
  for (const line of diagnosis.advice) ctx.ui.info(line);

  if (diagnosis.needsHuman) {
    return escalate(ctx, report, done, diagnosis.summary);
  }

  if (diagnosis.healthy) {
    // Rien d'anormal côté système : seul le client peut dire si le son sort vraiment.
    const heard = await ctx.ui.confirmFixed('Tout semble correct côté Windows. Entendez-vous du son ?');
    if (heard) return { status: 'fixed', actionsDone: done };
    return escalate(ctx, report, done, "Le système semble correct mais le client n'entend toujours rien");
  }

  const attempted = new Set<string>();
  const key = (a: Action) => `${a.id}|${a.title}`;
  let declinedAny = false;
  let current = diagnosis;
  let after: Diagnosis | null = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Une action déjà tentée (ou refusée) n'est jamais reproposée : pas de boucle, pas d'insistance.
    const fresh = current.actions.filter((a) => !attempted.has(key(a)));
    if (fresh.length === 0) break;

    const doneBefore = done.length;
    for (const action of fresh) {
      attempted.add(key(action));
      await report({ type: 'action_proposed', action: action.id, message: action.title });
      const approved = await ctx.ui.confirmAction(action);
      if (!approved) {
        declinedAny = true;
        await report({ type: 'action_declined', action: action.id, message: 'Refusé par le client' });
        continue;
      }
      await report({ type: 'action_approved', action: action.id, message: 'Accepté par le client' });

      const result = await runAction(action, ctx.runner);
      if (result.ok) {
        done.push(action.id);
        await report({ type: 'action_done', action: action.id, message: result.message });
      } else {
        await report({ type: 'action_failed', action: action.id, message: result.message });
        return escalate(
          ctx,
          report,
          done,
          `Échec de l'action « ${action.id} » : ${result.message}`,
          `Je n'ai pas réussi : ${truncate(result.message, 200)}`,
        );
      }
    }
    if (done.length === doneBefore) break; // rien n'a été appliqué (refus) : inutile de relire l'état

    // Vérification : on relit l'état (l'agent n'entend pas le son, c'est ensuite au client de le dire).
    try {
      after = await skill.diagnose(ctx.runner);
    } catch (err) {
      return escalate(ctx, report, done, `Vérification impossible : ${err instanceof Error ? err.message : String(err)}`);
    }
    await report({ type: 'verified', message: after.summary, details: { healthy: after.healthy, problems: after.problems } });

    if (after.healthy) {
      const heard = await ctx.ui.confirmFixed('Entendez-vous du son maintenant ?');
      if (heard) return { status: 'fixed', actionsDone: done };
      return escalate(ctx, report, done, "Corrections appliquées mais le client n'entend toujours rien");
    }
    if (after.needsHuman) return escalate(ctx, report, done, after.summary);
    // Un problème auparavant masqué peut apparaître une fois le premier réglé : on repropose.
    current = after;
  }

  if (done.length === 0) {
    if (declinedAny) return { status: 'declined', actionsDone: done };
    // Aucune action possible (ex. casque débranché) : les conseils ont été donnés.
    const heard = await ctx.ui.confirmFixed('Entendez-vous du son maintenant ?');
    if (heard) return { status: 'fixed', actionsDone: done };
    return escalate(ctx, report, done, 'Aucune correction automatique possible');
  }

  const summary = after?.summary ?? current.summary;
  ctx.ui.info(`Il reste un souci : ${summary}`);
  return escalate(ctx, report, done, `Problème persistant après correction : ${summary}`);
}

function truncate(message: string | undefined, max = MAX_MESSAGE_LENGTH): string | undefined {
  if (message === undefined || message.length <= max) return message;
  return `${message.slice(0, max - 1)}…`;
}

async function runAction(action: Action, runner: CommandRunner) {
  try {
    return await action.run(runner);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function escalate(
  ctx: AgentContext,
  report: (event: Omit<AgentEvent, 'skill'>) => Promise<boolean>,
  done: string[],
  reason: string,
  lead?: string,
): Promise<Outcome> {
  if (lead) ctx.ui.info(lead);
  const recorded = await report({ type: 'escalated', message: reason });
  if (recorded) {
    ctx.ui.info("Je passe la main à un technicien, qui verra tout ce que j'ai constaté et fait.");
  } else {
    // Le serveur n'a pas enregistré la demande : un technicien ne la verra pas. On le dit, sans prétendre le contraire.
    ctx.ui.info(
      "Je n'ai pas pu prévenir le serveur. Utilisez le bouton « Passer à un technicien » de l'application, ou réessayez dans un moment.",
    );
  }
  return { status: 'escalated', reason, actionsDone: done, recorded };
}

/** Un échec du journal ne doit jamais empêcher de dépanner le client : on le signale et on continue. */
async function safeReport(reporter: Reporter, event: AgentEvent): Promise<boolean> {
  try {
    await reporter.event(event);
    return true;
  } catch (err) {
    console.error(`[journal] impossible d'enregistrer « ${event.type} » :`, err instanceof Error ? err.message : err);
    return false;
  }
}
