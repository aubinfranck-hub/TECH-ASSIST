import { formatBytes } from './skills/common.js';
import type { MetricId, Metrics } from './types.js';

/**
 * Résultats chiffrés d'une intervention : ce que le client voit à la fin (avant → après), au lieu d'une simple liste d'actions.
 * Les mesures viennent de la relecture de Windows (jamais de l'IA) ; un indicateur « santé » résume les points constatés.
 */

export type RowTrend = 'better' | 'same' | 'worse';

export interface ResultRow {
  id: MetricId;
  label: string;
  before: string;
  after: string;
  /** « +3,2 Go », « −9 », « inchangé ». */
  change: string;
  trend: RowTrend;
}

export interface ResultAction {
  title: string;
  result: 'done' | 'failed' | 'declined';
  /** Effet mesuré (« 1,2 Go libérés »). */
  effect?: string;
}

export interface ResultsView {
  /** Indicateur de santé de l'ordinateur sur 100, avant puis après (seulement pour une analyse complète). */
  score?: { before: number; after: number };
  rows: ResultRow[];
  actions: ResultAction[];
  /** Certaines corrections ne prennent effet qu'au redémarrage : leurs effets ne sont pas encore mesurables. */
  pendingReboot: boolean;
  headline: string;
}

const MB = 1024 ** 2;
const sign = (d: number) => (d > 0 ? '+' : '−');

interface MetricDef {
  label: string;
  better: 'higher' | 'lower';
  /** En dessous de cet écart, la mesure est considérée inchangée (bruit de mesure). */
  tolerance: number;
  /** Mesure instantanée très variable : affichée seulement si elle s'améliore (jamais pour accuser un hasard). */
  noisy?: boolean;
  format(value: number): string;
  delta(diff: number): string;
}

const DEFS: Record<MetricId, MetricDef> = {
  freeBytes: { label: 'Espace libre sur le disque Windows', better: 'higher', tolerance: 50 * MB, format: formatBytes, delta: (d) => `${sign(d)}${formatBytes(Math.abs(d))}` },
  reclaimableBytes: { label: 'Fichiers inutiles à nettoyer', better: 'lower', tolerance: 50 * MB, format: formatBytes, delta: (d) => `${sign(d)}${formatBytes(Math.abs(d))}` },
  startupActive: { label: 'Programmes lancés au démarrage', better: 'lower', tolerance: 0, format: (n) => String(Math.round(n)), delta: (d) => `${sign(d)}${Math.abs(Math.round(d))}` },
  ramUsedPercent: { label: 'Mémoire utilisée', better: 'lower', tolerance: 3, noisy: true, format: (n) => `${Math.round(n)} %`, delta: (d) => `${sign(d)}${Math.abs(Math.round(d))} pts` },
  cpuPercent: { label: 'Processeur utilisé', better: 'lower', tolerance: 5, noisy: true, format: (n) => `${Math.round(n)} %`, delta: (d) => `${sign(d)}${Math.abs(Math.round(d))} pts` },
};
const ORDER: MetricId[] = ['freeBytes', 'reclaimableBytes', 'startupActive', 'ramUsedPercent', 'cpuPercent'];

/** Rassemble les mesures de plusieurs points d'analyse (la plus récente l'emporte). */
export function mergeMetrics(parts: { metrics?: Metrics }[]): Metrics {
  const out: Metrics = {};
  for (const p of parts) Object.assign(out, p.metrics ?? {});
  return out;
}

/** Lignes « avant → après » pour les mesures présentes des deux côtés. */
export function rowsFor(before: Metrics, after: Metrics): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const id of ORDER) {
    const b = before[id];
    const a = after[id];
    if (b === undefined || a === undefined) continue;
    const def = DEFS[id];
    const diff = a - b;
    const same = Math.abs(diff) <= def.tolerance;
    const improved = def.better === 'higher' ? diff > 0 : diff < 0;
    const trend: RowTrend = same ? 'same' : improved ? 'better' : 'worse';
    if (def.noisy && trend !== 'better') continue;
    rows.push({ id, label: def.label, before: def.format(b), after: def.format(a), change: same ? 'inchangé' : def.delta(diff), trend });
  }
  return rows;
}

interface Scored {
  severity: 'critical' | 'fixable' | 'watch' | 'ok' | 'unknown';
  metrics?: Metrics;
}

/** Indicateur simple et explicable : 100 points, moins 25 par problème pour un technicien, 12 par problème corrigeable, 4 par point à surveiller. */
export function healthScore(findings: Scored[]): number {
  const n = (s: Scored['severity']) => findings.filter((f) => f.severity === s).length;
  return Math.max(0, Math.min(100, 100 - 25 * n('critical') - 12 * n('fixable') - 4 * n('watch')));
}

function headline(rows: ResultRow[], actions: ResultAction[], pendingReboot: boolean): string {
  const done = actions.filter((a) => a.result === 'done');
  if (pendingReboot) return "Les corrections sont faites. Leur effet se mesurera après le redémarrage de l'ordinateur.";
  if (rows.some((r) => r.trend === 'better')) return "Voici ce qui a changé sur votre ordinateur.";
  if (done.length > 0) return "Corrections faites. Elles ne se chiffrent pas en espace ou en vitesse : l'analyse finale confirme le résultat.";
  return "Aucune modification n'a été faite.";
}

/** Analyse complète (« Réparer mon PC ») : avant/après de tous les points. `after` = `before` quand l'ordinateur redémarre : rien à relire. */
export function buildResults(before: Scored[], after: Scored[], actions: ResultAction[], pendingReboot = false): ResultsView {
  const rows = pendingReboot ? [] : rowsFor(mergeMetrics(before), mergeMetrics(after));
  return { score: { before: healthScore(before), after: pendingReboot ? healthScore(before) : healthScore(after) }, rows, actions, pendingReboot, headline: headline(rows, actions, pendingReboot) };
}

/** Une seule compétence : mesures avant/après de ce point, sans indicateur global. */
export function buildSkillResults(before: Metrics | undefined, after: Metrics | undefined, actions: ResultAction[], pendingReboot = false): ResultsView | null {
  const rows = pendingReboot || !before || !after ? [] : rowsFor(before, after);
  if (!rows.some((r) => r.trend !== 'same') && !actions.some((a) => a.effect)) return null; // rien de chiffré à montrer
  return { rows, actions, pendingReboot, headline: headline(rows, actions, pendingReboot) };
}

const MARK: Record<ResultAction['result'], string> = { done: '✔', failed: '✖', declined: '○' };

/** Texte du rapport (terminal, journal technicien) : mêmes informations que la carte de la fenêtre. */
export function formatResultsText(view: ResultsView): string {
  const lines = ['RÉSULTATS', view.headline];
  if (view.score) lines.push(`Santé de l'ordinateur : ${view.score.before}/100 → ${view.score.after}/100`);
  for (const r of view.rows) lines.push(`• ${r.label} : ${r.before} → ${r.after}${r.trend === 'same' ? ' (inchangé)' : ` (${r.change})`}`);
  const effects = view.actions.filter((a) => a.effect);
  for (const a of effects) lines.push(`${MARK[a.result]} ${a.title} : ${a.effect}`);
  return lines.join('\n');
}

/** Une ligne pour le journal du technicien. */
export function summarizeResults(view: ResultsView): string {
  const parts: string[] = [];
  if (view.score) parts.push(`santé ${view.score.before} → ${view.score.after}/100`);
  for (const r of view.rows) if (r.trend !== 'same') parts.push(`${r.label.toLowerCase()} ${r.before} → ${r.after}`);
  for (const a of view.actions) if (a.effect) parts.push(`${a.title.toLowerCase()} : ${a.effect}`);
  if (view.pendingReboot) parts.push('effets mesurables après redémarrage');
  return `Résultats : ${parts.join(' ; ') || 'aucun changement mesurable'}`;
}
