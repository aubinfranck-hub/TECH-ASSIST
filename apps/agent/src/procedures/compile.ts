import { runScript, readScript } from '../skills/common.js';
import { withRestorePoint } from '../skills/safety.js';
import type { Action, ActionResult, CommandRunner, Diagnosis, Skill } from '../types.js';
import { actScript, actionIdFor, observeScript, parseFacts } from './builders.js';
import { actExplanation, actTitle, expectationMet, traitsOf, validateProcedure, type Checked, type Check, type Fix, type Procedure } from './manifest.js';

/**
 * Transforme une procédure apprise en compétence de l'agent (observer → proposer → agir → vérifier).
 *
 * La procédure est REVALIDÉE ici, quelle que soit sa provenance (mémoire du serveur, IA, cache) : l'agent ne fait confiance
 * ni au serveur ni à l'IA. Seules les opérations du catalogue (manifest.ts) peuvent en sortir, avec des paramètres déjà contrôlés.
 */

export interface CompiledProcedure {
  procedure: Procedure;
  skill: Skill;
}

/** Messages de réussite qui n'apprennent rien au client : on ne les présente pas comme un effet. */
const PLAIN_OK = new Set(['OK', 'Déjà fermé']);

export function compileProcedure(raw: unknown, procedureId: string): Checked<CompiledProcedure> {
  const checked = validateProcedure(raw);
  if (!checked.ok) return checked;
  const procedure = checked.value;
  if (!/^[0-9a-f-]{8,40}$/i.test(procedureId)) return { ok: false, error: 'Identifiant de procédure invalide' };

  /** Vrai dès qu'une correction a été appliquée : sans vérification objective, c'est alors au client de dire si c'est réglé. */
  let applied = false;

  const toAction = (fix: Fix): Action => {
    const traits = traitsOf(fix.tool, fix.args);
    const { script, timeoutMs } = actScript(fix.tool, fix.args);
    const action: Action = {
      id: actionIdFor(fix.tool, fix.args, fix.id),
      title: actTitle(fix.tool, fix.args),
      explanation: `${actExplanation(fix.tool, fix.args)} Pourquoi : ${fix.why}`,
      requiresAdmin: traits.admin,
      verified: true,
      ...(traits.reboot ? { needsReboot: true } : {}),
      run: async (runner: CommandRunner): Promise<ActionResult> => {
        const result = await runScript(runner, script, timeoutMs);
        if (result.ok) {
          applied = true;
          const message = result.message.trim();
          if (message && !PLAIN_OK.has(message)) return { ...result, effect: message };
        }
        return result;
      },
    };
    return traits.sensitive ? withRestorePoint(action) : action;
  };

  const skill: Skill = {
    id: `learned:${procedureId}`,
    title: procedure.title,
    verifyQuestion: procedure.verifyQuestion,
    async diagnose(runner: CommandRunner): Promise<Diagnosis> {
      const failed: Check[] = [];
      const unreadable = new Set<string>();
      for (const check of procedure.checks) {
        try {
          const facts = parseFacts(check.tool, await readScript(runner, observeScript(check.tool, check.args), check.id, 45_000));
          if (!expectationMet(facts, check.expect)) failed.push(check);
        } catch {
          unreadable.add(check.id);
        }
      }
      const evaluable = procedure.checks.length - unreadable.size;
      // Des contrôles objectifs décident ; sans eux, une fois la correction appliquée, c'est le client qui confirme.
      const healthy = evaluable > 0 ? failed.length === 0 : applied;
      const failedIds = new Set(failed.map((c) => c.id));
      const wanted = (fix: Fix) => !fix.onlyIf || fix.onlyIf.some((id) => failedIds.has(id) || unreadable.has(id));
      const actions = healthy ? [] : procedure.fixes.filter(wanted).map(toAction);

      let summary: string;
      if (failed.length > 0) summary = `Constat : ${failed.map((c) => c.problem).join(' ; ')}`;
      else if (evaluable > 0) summary = "Les contrôles ne montrent rien d'anormal.";
      else summary = procedure.summary;
      if (unreadable.size > 0 && evaluable > 0) summary += ` (${unreadable.size} contrôle(s) n'ont pas pu être lus.)`;

      return {
        summary,
        problems: failed.map((c) => c.id),
        actions,
        advice: healthy ? [] : procedure.advice,
        healthy,
        // Un problème constaté sans aucun remède (ni correction ni conseil) dépasse la procédure : un technicien reprend.
        needsHuman: !healthy && failed.length > 0 && actions.length === 0 && procedure.advice.length === 0,
      };
    },
  };
  return { ok: true, value: { procedure, skill } };
}
