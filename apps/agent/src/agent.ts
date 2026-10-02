import { formatReport, type InterventionReport, type ReportAction, type ReportStatus } from './report.js';
import { confirmOnly, rebootAction } from './skills/safety.js';
import type { Action, ActionResult, AgentEvent, CommandRunner, Diagnosis, Reporter, Skill, Ui } from './types.js';

export type Outcome =
  | { status: 'fixed'; actionsDone: string[] }
  | { status: 'declined'; actionsDone: string[] }
  /** Les corrections ne prennent effet qu'après redémarrage : rien n'a pu être vérifié. `rebooting` : le client a accepté. */
  | { status: 'reboot_needed'; actionsDone: string[]; rebooting: boolean }
  /** `recorded` : false si le serveur n'a pas pu enregistrer le passage de main (le client en est prévenu). */
  | { status: 'escalated'; reason: string; actionsDone: string[]; recorded: boolean };

/** Nombre maximal de tours « corriger puis relire » : un nouveau problème peut apparaître une fois un autre réglé. */
const MAX_ROUNDS = 3;
/** Limite du serveur sur le texte d'un événement ; au-delà, l'événement serait refusé et le passage de main perdu. */
export const MAX_MESSAGE_LENGTH = 500;

export interface AgentContext {
  runner: CommandRunner;
  ui: Ui;
  reporter: Reporter;
  /** Horloge (tests). */
  now?: () => number;
  /** Nom de l'ordinateur, imprimé en tête du rapport. */
  machine?: string;
  /** Préparations déjà faites (point de restauration) : partagé entre plusieurs compétences d'une même intervention. */
  prepared?: Set<string>;
  /** Ne pas imprimer le rapport de cette compétence (l'appelant en produit un global). */
  quiet?: boolean;
  /** Ne pas proposer le redémarrage tout de suite : l'appelant le propose une fois, à la fin. */
  deferReboot?: boolean;
}

/** Ce que l'agent a constaté et fait, pour le rapport d'intervention. */
interface Trace {
  diagnosis: string;
  actions: ReportAction[];
  test: string;
  rebootNeeded: boolean;
}

/**
 * Boucle de l'agent : observer → proposer → (accord du client) → agir → vérifier → rapport.
 *
 * Garanties :
 * - la lecture de l'état est seule autorisée sans accord ; toute modification est
 *   proposée avec une explication, et ne part que sur un « oui » explicite ;
 * - seules les actions de la compétence (liste blanche) peuvent s'exécuter ;
 * - une action sensible est précédée d'un point de restauration Windows (avec l'accord du client) ;
 * - chaque étape est rapportée (journal côté serveur et console locale) ;
 * - quand l'agent n'y arrive pas, il passe la main à un technicien au lieu d'insister.
 */
export async function runSkill(skill: Skill, ctx: AgentContext): Promise<Outcome> {
  const now = ctx.now ?? Date.now;
  const started = now();
  const trace: Trace = { diagnosis: '', actions: [], test: '', rebootNeeded: false };
  const outcome = await runCore(skill, ctx, trace);
  if (!ctx.quiet) ctx.ui.info(formatReport(buildReport(skill, outcome, trace, now() - started, ctx.machine)));
  return outcome;
}

function buildReport(skill: Skill, outcome: Outcome, trace: Trace, durationMs: number, machine?: string): InterventionReport {
  const status: ReportStatus =
    outcome.status === 'fixed'
      ? 'resolved'
      : outcome.status === 'declined'
        ? 'declined'
        : outcome.status === 'reboot_needed'
          ? 'reboot'
          : outcome.actionsDone.length > 0
            ? 'partial'
            : 'unresolved';
  return { machine, task: skill.title, diagnosis: trace.diagnosis, actions: trace.actions, test: trace.test, status, durationMs };
}

async function runCore(skill: Skill, ctx: AgentContext, trace: Trace): Promise<Outcome> {
  const done: string[] = [];
  const report = (event: Omit<AgentEvent, 'skill'>) =>
    safeReport(ctx.reporter, { ...event, skill: skill.id, message: truncate(event.message) });

  let diagnosis: Diagnosis;
  try {
    diagnosis = await skill.diagnose(ctx.runner);
  } catch (err) {
    const reason = `Diagnostic impossible : ${err instanceof Error ? err.message : String(err)}`;
    trace.diagnosis = reason;
    return escalate(ctx, report, done, reason, "Je n'arrive pas à analyser votre appareil.");
  }

  trace.diagnosis = diagnosis.summary;
  await report({ type: 'diagnosed', message: diagnosis.summary, details: { problems: diagnosis.problems } });
  ctx.ui.info(diagnosis.summary);
  for (const line of diagnosis.advice) ctx.ui.info(line);

  if (diagnosis.needsHuman) {
    return escalate(ctx, report, done, diagnosis.summary);
  }

  if (diagnosis.healthy) {
    // Rien d'anormal côté système : seul le client peut dire si le problème est réellement réglé.
    const ok = await ctx.ui.confirmFixed(`Tout semble correct côté Windows. ${skill.verifyQuestion}`);
    trace.test = ok ? 'Rien d\'anormal côté Windows ; confirmé par le client.' : 'Rien d\'anormal côté Windows ; le problème persiste pour le client.';
    if (ok) return { status: 'fixed', actionsDone: done };
    return escalate(ctx, report, done, 'Le système semble correct mais le problème persiste pour le client');
  }

  const attempted = new Set<string>();
  const prepared = ctx.prepared ?? new Set<string>();
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
        trace.actions.push({ title: action.title, result: 'declined' });
        await report({ type: 'action_declined', action: action.id, message: 'Refusé par le client' });
        continue;
      }
      await report({ type: 'action_approved', action: action.id, message: 'Accepté par le client' });

      // Point de restauration (ou autre préparation) : après l'accord, avant la modification.
      if (!(await ensurePrepared(action, ctx, report, prepared))) {
        declinedAny = true;
        trace.actions.push({ title: action.title, result: 'declined' });
        await report({ type: 'action_declined', action: action.id, message: 'Refusé par le client : pas de point de restauration' });
        continue;
      }

      const result = await runAction(action, ctx.runner);
      if (result.ok) {
        done.push(action.id);
        trace.actions.push({ title: action.title, result: 'done' });
        if (action.needsReboot) trace.rebootNeeded = true;
        await report({ type: 'action_done', action: action.id, message: result.message });
        if (action.followUp) ctx.ui.info(action.followUp);
      } else {
        trace.actions.push({ title: action.title, result: 'failed' });
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

    // Ces corrections ne prennent effet qu'au redémarrage : on ne peut rien vérifier avant, et on ne prétend pas le contraire.
    if (trace.rebootNeeded) {
      trace.test = 'Non vérifié : les corrections ne prennent effet qu\'après le redémarrage.';
      if (ctx.deferReboot) return { status: 'reboot_needed', actionsDone: done, rebooting: false };
      return offerReboot(ctx, report, done);
    }

    // Vérification : on relit l'état, puis c'est au client de confirmer que ça fonctionne.
    try {
      after = await skill.diagnose(ctx.runner);
    } catch (err) {
      return escalate(ctx, report, done, `Vérification impossible : ${err instanceof Error ? err.message : String(err)}`);
    }
    trace.test = `Relecture de Windows : ${after.summary}`;
    await report({ type: 'verified', message: after.summary, details: { healthy: after.healthy, problems: after.problems } });

    if (after.healthy) {
      const ok = await ctx.ui.confirmFixed(skill.verifyQuestion);
      trace.test += ok ? ' Confirmé par le client.' : ' Le problème persiste pour le client.';
      if (ok) return { status: 'fixed', actionsDone: done };
      return escalate(ctx, report, done, 'Corrections appliquées mais le problème persiste pour le client');
    }
    if (after.needsHuman) return escalate(ctx, report, done, after.summary);
    // Un problème auparavant masqué peut apparaître une fois le premier réglé : on repropose.
    current = after;
  }

  if (done.length === 0) {
    if (declinedAny) return { status: 'declined', actionsDone: done };
    // Aucune action possible (ex. casque débranché) : les conseils ont été donnés.
    const ok = await ctx.ui.confirmFixed(skill.verifyQuestion);
    trace.test = ok ? 'Aucune correction automatique possible ; confirmé par le client après les conseils.' : 'Aucune correction automatique possible ; le problème persiste.';
    if (ok) return { status: 'fixed', actionsDone: done };
    return escalate(ctx, report, done, 'Aucune correction automatique possible');
  }

  const summary = after?.summary ?? current.summary;
  ctx.ui.info(`Il reste un souci : ${summary}`);
  return escalate(ctx, report, done, `Problème persistant après correction : ${summary}`);
}

export function truncate(message: string | undefined, max = MAX_MESSAGE_LENGTH): string | undefined {
  if (message === undefined || message.length <= max) return message;
  return `${message.slice(0, max - 1)}…`;
}

export async function runAction(action: Action, runner: CommandRunner): Promise<ActionResult> {
  try {
    return await action.run(runner);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

type Report = (event: Omit<AgentEvent, 'skill'>) => Promise<boolean>;

/**
 * Lance la préparation de l'action (point de restauration) une seule fois. Si elle échoue, le client décide :
 * continuer sans filet, ou renoncer à l'action. Renvoie false si l'action ne doit pas être lancée.
 */
export async function ensurePrepared(action: Action, ctx: { runner: CommandRunner; ui: Ui }, report: Report, prepared: Set<string>): Promise<boolean> {
  const prep = action.prepare;
  if (!prep || prepared.has(prep.id)) return true;
  const result = await runAction(prep, ctx.runner);
  if (result.ok) {
    prepared.add(prep.id);
    await report({ type: 'action_done', action: prep.id, message: prep.title });
    ctx.ui.info(`${prep.title} : fait.`);
    return true;
  }
  await report({ type: 'action_failed', action: prep.id, message: result.message });
  return ctx.ui.confirmAction(
    confirmOnly(
      `Continuer sans « ${prep.title} » ?`,
      `Je n'ai pas pu le faire : ${truncate(result.message, 200)}. Si vous continuez, Windows ne pourra pas revenir en arrière automatiquement en cas de problème. Vous pouvez aussi refuser : rien ne sera modifié.`,
    ),
  );
}

/** Propose le redémarrage (délai de 60 s, annulable). Rien n'est vérifié avant : on ne peut pas. */
export async function offerReboot(ctx: { runner: CommandRunner; ui: Ui }, report: Report, done: string[]): Promise<Outcome> {
  ctx.ui.info("Ces corrections ne seront actives qu'après le redémarrage de l'ordinateur. Je ne peux donc pas encore vérifier le résultat.");
  const reboot = rebootAction();
  let rebooting = false;
  if (await ctx.ui.confirmAction(reboot)) {
    const result = await runAction(reboot, ctx.runner);
    rebooting = result.ok;
    await report({ type: result.ok ? 'action_done' : 'action_failed', action: reboot.id, message: result.message });
    if (!result.ok) ctx.ui.info(`Je n'ai pas pu lancer le redémarrage (${truncate(result.message, 200)}). Redémarrez l'ordinateur vous-même.`);
  } else {
    ctx.ui.info("D'accord. Redémarrez l'ordinateur quand vous voulez, puis redemandez-moi de vérifier.");
  }
  return { status: 'reboot_needed', actionsDone: done, rebooting };
}

export async function escalate(
  ctx: { ui: Ui },
  report: Report,
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
export async function safeReport(reporter: Reporter, event: AgentEvent): Promise<boolean> {
  try {
    await reporter.event(event);
    return true;
  } catch (err) {
    console.error(`[journal] impossible d'enregistrer « ${event.type} » :`, err instanceof Error ? err.message : err);
    return false;
  }
}
