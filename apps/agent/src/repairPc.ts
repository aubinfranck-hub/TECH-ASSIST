import { escalate, offerReboot, runSkill, safeReport, showResults, truncate, type AgentContext, type Outcome } from './agent.js';
import { formatReport, type ReportAction, type ReportStatus } from './report.js';
import { buildResults, formatResultsText } from './results.js';
import { batterySkill } from './skills/battery.js';
import { cleanupSkill } from './skills/cleanup.js';
import { crashesSkill } from './skills/crashes.js';
import { diskSkill } from './skills/disk.js';
import { driversSkill } from './skills/drivers.js';
import { networkSkill } from './skills/network.js';
import { performanceSkill } from './skills/performance.js';
import { securitySkill } from './skills/security.js';
import { confirmOnly } from './skills/safety.js';
import { startupSkill } from './skills/startup.js';
import { windowsRepairSkill } from './skills/windowsRepair.js';
import { plannedTasks, RESCAN_TASK, SCAN_TASK, tracked, type TaskInfo } from './tasks.js';
import type { Action, Diagnosis, Metrics, Reporter, Skill, Ui } from './types.js';

/**
 * « RÉPARER MON PC » : diagnostic complet → classement par gravité → un seul « oui » pour le lot →
 * (point de restauration une fois) → corrections, chacune avec son explication et son accord → redémarrage une seule fois
 * → seconde analyse → rapport. L'accord global ne remplace pas l'accord de chaque action sensible : chaque modification
 * est quand même présentée avant d'être faite.
 */

export type Severity = 'critical' | 'fixable' | 'watch' | 'ok' | 'unknown';

export interface Finding {
  id: string;
  label: string;
  severity: Severity;
  summary: string;
  advice: string[];
  /** Mesures chiffrées de ce point (espace libre, programmes au démarrage…) : comparées avant/après dans les résultats. */
  metrics?: Metrics;
}

export interface RepairStep {
  id: string;
  label: string;
  build(): Skill;
}

/** Ordre voulu : le réseau d'abord (DISM et les pilotes en ont besoin), l'analyse des fichiers système avant les finitions. */
export const REPAIR_STEPS: RepairStep[] = [
  { id: 'network', label: 'Réseau', build: networkSkill },
  { id: 'security', label: 'Sécurité', build: securitySkill },
  { id: 'disk', label: 'Disque', build: diskSkill },
  { id: 'cleanup', label: 'Espace et nettoyage', build: cleanupSkill },
  { id: 'windows-repair', label: 'Fichiers système Windows', build: () => windowsRepairSkill({ runSfc: false }) },
  { id: 'drivers', label: 'Pilotes et appareils', build: driversSkill },
  { id: 'crashes', label: 'Plantages', build: crashesSkill },
  { id: 'startup', label: 'Démarrage', build: startupSkill },
  { id: 'performance', label: 'Performances', build: performanceSkill },
  { id: 'battery', label: 'Batterie', build: batterySkill },
];

/** Gravité : 🔴 hors de portée de l'agent, 🟠 corrigeable, 🟡 à surveiller, 🟢 sain. */
export function classify(d: Diagnosis): Severity {
  if (d.needsHuman) return 'critical';
  if (!d.healthy && d.actions.length > 0) return 'fixable';
  if (!d.healthy) return 'watch'; // problème constaté sans action possible : conseil seulement
  return d.advice.length > 0 ? 'watch' : 'ok';
}

const MARK: Record<Severity, string> = { critical: '🔴', fixable: '🟠', watch: '🟡', ok: '🟢', unknown: '⚪' };

/** Analyse complète en lecture seule. Une analyse qui échoue est signalée, jamais ignorée. */
export async function scanPc(runner: AgentContext['runner'], steps: RepairStep[] = REPAIR_STEPS): Promise<Finding[]> {
  return (await scanPcDetailed(runner, steps)).findings;
}

/** Comme `scanPc`, avec en plus les tâches que demanderaient les corrections de chaque point (pour annoncer le programme au client). */
async function scanPcDetailed(runner: AgentContext['runner'], steps: RepairStep[]): Promise<{ findings: Finding[]; plans: Map<string, TaskInfo[]> }> {
  const findings: Finding[] = [];
  const plans = new Map<string, TaskInfo[]>();
  for (const step of steps) {
    try {
      const d = await step.build().diagnose(runner);
      findings.push({ id: step.id, label: step.label, severity: classify(d), summary: d.summary, advice: d.advice, ...(d.metrics ? { metrics: d.metrics } : {}) });
      if (d.actions.length > 0) plans.set(step.id, plannedTasks(d.actions));
    } catch (err) {
      findings.push({ id: step.id, label: step.label, severity: 'unknown', summary: `Analyse impossible : ${truncate(err instanceof Error ? err.message : String(err), 160)}`, advice: [] });
    }
  }
  return { findings, plans };
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function formatFindings(findings: Finding[]): string {
  return findings.map((f) => `${MARK[f.severity]} ${f.label} : ${f.summary.split('\n')[0]}`).join('\n');
}

export type RepairOutcome =
  | { status: 'nothing_to_fix'; findings: Finding[] }
  | { status: 'declined'; findings: Finding[] }
  /** `escalated` : un technicien a été prévenu ET le serveur l'a enregistré. */
  | { status: 'repaired' | 'partial'; before: Finding[]; after: Finding[]; actionsDone: string[]; reboot: 'accepted' | 'declined' | 'none'; escalated: boolean };

export async function repairMyPc(ctx: AgentContext, steps: RepairStep[] = REPAIR_STEPS): Promise<RepairOutcome> {
  const now = ctx.now ?? Date.now;
  const started = now();
  const report = (event: { type: 'diagnosed' | 'action_proposed' | 'action_approved' | 'action_declined' | 'action_done' | 'action_failed' | 'verified' | 'escalated' | 'user_request'; action?: string; message?: string; details?: Record<string, unknown> }) =>
    safeReport(ctx.reporter, { ...event, skill: 'repair-pc', message: truncate(event.message) });

  ctx.ui.info(ctx.friendly ? "Je regarde l'état de votre ordinateur. Rien n'est modifié pour l'instant, cela prend une à deux minutes." : 'Je commence par analyser votre ordinateur, sans rien modifier.');
  const scan = await tracked(ctx.ui, SCAN_TASK, () => scanPcDetailed(ctx.runner, steps));
  const before = scan.findings;
  const count = (s: Severity) => before.filter((f) => f.severity === s).length;
  const fixable = before.filter((f) => f.severity === 'fixable');
  const critical = before.filter((f) => f.severity === 'critical');
  const issues = fixable.length + critical.length;

  if (ctx.friendly) {
    const toFix = [...critical, ...fixable];
    ctx.ui.info(
      issues === 0
        ? 'Bonne nouvelle : je ne vois aucun problème à corriger sur votre ordinateur.'
        : `J'ai trouvé ${plural(issues, 'point à corriger', 'points à corriger')} :\n${toFix.map((f) => `• ${f.label} : ${f.summary.split('\n')[0]}`).join('\n')}\nTout le reste est en bon état.`,
    );
    for (const f of toFix) for (const line of f.advice) ctx.ui.info(`${f.label} : ${line}`);
  } else {
    ctx.ui.info(
      issues === 0
        ? `Diagnostic : aucun problème à corriger.\n${formatFindings(before)}`
        : `Diagnostic : ${plural(issues, 'problème détecté', 'problèmes détectés')}. ${plural(fixable.length, 'peut être corrigé', 'peuvent être corrigés')} automatiquement, ${plural(critical.length, 'nécessite', 'nécessitent')} un technicien.\n${formatFindings(before)}`,
    );
    for (const f of before) for (const line of f.advice) ctx.ui.info(`${f.label} : ${line}`);
  }
  await report({ type: 'diagnosed', message: `${issues} problème(s) : ${fixable.length} corrigeable(s), ${critical.length} pour un technicien, ${count('watch')} à surveiller`, details: { fixable: fixable.map((f) => f.id), critical: critical.map((f) => f.id) } });

  if (issues === 0) {
    ctx.ui.tasks?.settle();
    return { status: 'nothing_to_fix', findings: before };
  }

  const log = new Recording(ctx.ui, ctx.reporter);
  const done: string[] = [];
  const subCtx: AgentContext = { ...ctx, ui: log.ui, reporter: log.reporter, prepared: new Set<string>(), quiet: true, deferReboot: true, skipConfirm: true };
  let rebootNeeded = false;
  let handedOff = false;
  let recorded = false;

  if (fixable.length > 0) {
    const go = await ctx.ui.confirmAction(
      confirmOnly(
        `RÉPARER LES ${fixable.length} PROBLÈME${fixable.length > 1 ? 'S' : ''}`,
        `Je vais corriger : ${fixable.map((f) => f.label).join(', ')}. Pour chaque correction, je vous explique ce qui change et je demande votre accord avant de le faire. Si un changement est difficile à défaire, un point de restauration Windows est créé d'abord. Vos documents, photos et courriers ne sont jamais touchés.`,
      ),
    );
    if (!go) {
      await report({ type: 'action_declined', message: 'Réparation complète refusée par le client' });
      ctx.ui.tasks?.settle();
      ctx.ui.info("D'accord, je n'ai rien modifié.");
      ctx.ui.info(formatReport({ machine: ctx.machine, task: 'Réparer mon PC', diagnosis: formatFindings(before), actions: [], test: 'Aucune modification.', status: 'declined', durationMs: now() - started }));
      return { status: 'declined', findings: before };
    }
    // Le programme complet est annoncé d'avance : le client voit ce qui l'attend et le temps restant approximatif.
    ctx.ui.tasks?.plan([...fixable.flatMap((f) => scan.plans.get(f.id) ?? []), RESCAN_TASK]);
    for (const f of fixable) {
      const step = steps.find((s) => s.id === f.id)!;
      ctx.ui.info(`— ${f.label} —`);
      const outcome: Outcome = await runSkill(step.build(), subCtx);
      done.push(...outcome.actionsDone);
      if (outcome.status === 'escalated' && outcome.recorded) recorded = true;
      if (outcome.status === 'reboot_needed') rebootNeeded = true;
    }
  }

  // Les problèmes hors de portée : un seul passage de main, honnête sur ce qui a été enregistré.
  if (critical.length > 0) {
    ctx.ui.info(`À confier à un technicien : ${critical.map((f) => f.label).join(', ')}.`);
    const esc = await escalate(ctx, report, done, `Réparer mon PC : ${critical.map((f) => `${f.label} (${f.summary.split('\n')[0]})`).join(' ; ')}`);
    handedOff = true;
    recorded = esc.status === 'escalated' && esc.recorded;
  }

  let reboot: 'accepted' | 'declined' | 'none' = 'none';
  if (rebootNeeded) {
    const out = await offerReboot(ctx, (e) => report(e), done);
    reboot = out.status === 'reboot_needed' && out.rebooting ? 'accepted' : 'declined';
  }

  // Seconde analyse : on ne conclut pas sans avoir relu l'état (sauf si le redémarrage a été lancé : rien à relire maintenant).
  const after = reboot === 'accepted' ? before : fixable.length > 0 || critical.length > 0 ? await tracked(ctx.ui, RESCAN_TASK, () => scanPc(ctx.runner, steps)) : before;
  ctx.ui.tasks?.settle();
  const remainingFix = reboot === 'accepted' ? 0 : after.filter((f) => f.severity === 'fixable').length;
  const remainingCrit = critical.length;
  if (fixable.length > 0 && reboot !== 'accepted') await report({ type: 'verified', message: `Seconde analyse : ${remainingFix} problème(s) corrigeable(s) restant(s)`, details: { remaining: after.filter((f) => f.severity === 'fixable').map((f) => f.id) } });

  const status: ReportStatus =
    reboot === 'accepted' ? 'reboot' : remainingFix === 0 && remainingCrit === 0 ? 'resolved' : done.length > 0 || (fixable.length === 0 && handedOff) ? 'partial' : 'unresolved';
  const actions: ReportAction[] = log.actions();
  // Ce qui a vraiment changé, chiffré : carte « Résultats » dans la fenêtre, même contenu dans le rapport et le journal du technicien.
  const results = buildResults(before, after, actions, reboot === 'accepted');
  if (done.length > 0 || critical.length > 0) await showResults(ctx, 'repair-pc', results);
  ctx.ui.info(
    formatReport({
      machine: ctx.machine,
      task: 'Réparer mon PC',
      diagnosis: formatFindings(before),
      actions,
      test: reboot === 'accepted' ? "Non vérifié : l'ordinateur redémarre, relancez une analyse ensuite." : `Seconde analyse :\n${formatFindings(after)}`,
      status,
      durationMs: now() - started,
      ...(done.length > 0 ? { results: formatResultsText(results) } : {}),
    }),
  );
  return { status: status === 'resolved' ? 'repaired' : 'partial', before, after, actionsDone: done, reboot, escalated: recorded };
}

/** Observe l'interface et le journal pendant les corrections, pour dresser la liste des actions du rapport global. */
class Recording {
  private readonly titles = new Map<string, string>();
  private readonly results = new Map<string, ReportAction['result']>();
  private readonly effects = new Map<string, string>();
  private readonly order: string[] = [];

  constructor(
    private readonly inner: Ui,
    private readonly outer: Reporter,
  ) {
    // Le suivi des tâches de la fenêtre reste branché pendant les corrections.
    if (inner.tasks) this.ui.tasks = inner.tasks;
  }

  private note(key: string, title: string, result: ReportAction['result']) {
    if (!this.titles.has(key)) this.order.push(key);
    this.titles.set(key, title);
    this.results.set(key, result);
  }

  private lastProposed: Action | null = null;

  readonly ui: Ui = {
    info: (m) => this.inner.info(m),
    confirmFixed: (q) => this.inner.confirmFixed(q),
    confirmAction: async (action) => {
      this.lastProposed = action;
      const ok = await this.inner.confirmAction(action);
      if (!ok) this.note(`${action.id}|${action.title}`, action.title, 'declined');
      else this.note(`${action.id}|${action.title}`, action.title, 'done'); // corrigé en 'failed' par le journal si l'exécution échoue
      return ok;
    },
  };

  readonly reporter: Reporter = {
    event: async (e) => {
      if (this.lastProposed && e.action === this.lastProposed.id) {
        const key = `${this.lastProposed.id}|${this.lastProposed.title}`;
        if (e.type === 'action_failed') this.results.set(key, 'failed');
        if (e.type === 'action_declined') this.results.set(key, 'declined'); // ex. refus de continuer sans point de restauration
        const effect = (e.details as { effect?: unknown } | undefined)?.effect;
        if (e.type === 'action_done' && typeof effect === 'string') this.effects.set(key, effect);
      }
      await this.outer.event(e);
    },
  };

  actions(): ReportAction[] {
    return this.order
      .filter((k) => !k.startsWith('confirm_only|'))
      .map((k) => ({ title: this.titles.get(k)!, result: this.results.get(k)!, ...(this.effects.has(k) ? { effect: this.effects.get(k)! } : {}) }));
  }
}
