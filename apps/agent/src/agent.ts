import type { Action, AgentEvent, CommandRunner, Diagnosis, Reporter, Skill, Ui } from './types.js';

export type Outcome =
  | { status: 'fixed'; actionsDone: string[] }
  | { status: 'declined'; actionsDone: string[] }
  | { status: 'escalated'; reason: string; actionsDone: string[] };

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
  const report = (event: Omit<AgentEvent, 'skill'>) => safeReport(ctx.reporter, { ...event, skill: skill.id });

  let diagnosis: Diagnosis;
  try {
    diagnosis = await skill.diagnose(ctx.runner);
  } catch (err) {
    const reason = `Diagnostic impossible : ${err instanceof Error ? err.message : String(err)}`;
    ctx.ui.info("Je n'arrive pas à analyser votre appareil. Je passe la main à un technicien.");
    await report({ type: 'escalated', message: reason });
    return { status: 'escalated', reason, actionsDone: done };
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
    return escalate(ctx, report, done, 'Le système semble correct mais le client n\'entend toujours rien');
  }

  let declinedAny = false;
  for (const action of diagnosis.actions) {
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
      ctx.ui.info(`Je n'ai pas réussi : ${result.message}`);
      return escalate(ctx, report, done, `Échec de l'action « ${action.id} » : ${result.message}`);
    }
  }

  if (done.length === 0) {
    if (declinedAny) return { status: 'declined', actionsDone: done };
    // Aucune action possible (ex. casque débranché) : les conseils ont été donnés.
    const heard = await ctx.ui.confirmFixed('Entendez-vous du son maintenant ?');
    if (heard) return { status: 'fixed', actionsDone: done };
    return escalate(ctx, report, done, 'Aucune correction automatique possible');
  }

  // Vérification : on relit l'état, puis on demande au client (l'agent n'entend pas le son).
  let after: Diagnosis;
  try {
    after = await skill.diagnose(ctx.runner);
  } catch (err) {
    return escalate(ctx, report, done, `Vérification impossible : ${err instanceof Error ? err.message : String(err)}`);
  }
  await report({ type: 'verified', message: after.summary, details: { healthy: after.healthy, problems: after.problems } });

  if (!after.healthy) {
    ctx.ui.info(`Il reste un souci : ${after.summary}`);
    return escalate(ctx, report, done, `Problème persistant après correction : ${after.summary}`);
  }
  const heard = await ctx.ui.confirmFixed('Entendez-vous du son maintenant ?');
  if (heard) return { status: 'fixed', actionsDone: done };
  return escalate(ctx, report, done, 'Corrections appliquées mais le client n\'entend toujours rien');
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
  report: (event: Omit<AgentEvent, 'skill'>) => Promise<void>,
  done: string[],
  reason: string,
): Promise<Outcome> {
  ctx.ui.info('Je passe la main à un technicien, qui verra tout ce que j\'ai constaté et fait.');
  await report({ type: 'escalated', message: reason });
  return { status: 'escalated', reason, actionsDone: done };
}

/** Un échec du journal ne doit jamais empêcher de dépanner le client : on le signale et on continue. */
async function safeReport(reporter: Reporter, event: AgentEvent): Promise<void> {
  try {
    await reporter.event(event);
  } catch (err) {
    console.error(`[journal] impossible d'enregistrer « ${event.type} » :`, err instanceof Error ? err.message : err);
  }
}
