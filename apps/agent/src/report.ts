/** Rapport d'intervention montré au client à la fin de chaque tâche (jamais envoyé tel quel au serveur : le journal d'événements suffit). */

export type ReportStatus = 'resolved' | 'partial' | 'unresolved' | 'declined' | 'reboot';

export interface ReportAction {
  title: string;
  result: 'done' | 'failed' | 'declined';
}

export interface InterventionReport {
  /** Nom de l'ordinateur (facultatif). */
  machine?: string;
  task: string;
  diagnosis: string;
  actions: ReportAction[];
  /** Ce qui a été revérifié après correction (relecture de Windows, confirmation du client). */
  test: string;
  status: ReportStatus;
  durationMs: number;
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  resolved: '🟢 RÉSOLU',
  partial: '🟠 PARTIELLEMENT RÉSOLU',
  unresolved: '🔴 NON RÉSOLU',
  declined: '⚪ AUCUNE MODIFICATION (refusée par vous)',
  reboot: '🟡 EN ATTENTE DE REDÉMARRAGE',
};

const ACTION_MARK: Record<ReportAction['result'], string> = { done: '✔', failed: '✖ échec :', declined: '○ refusée :' };

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 1) return "moins d'une seconde";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

export function formatReport(report: InterventionReport): string {
  const lines = ["RAPPORT D'INTERVENTION", ''];
  if (report.machine) lines.push('ORDINATEUR', report.machine, '');
  lines.push('TÂCHE', report.task, '', '', 'DIAGNOSTIC', report.diagnosis || 'Aucun diagnostic');
  lines.push('', 'ACTIONS');
  if (report.actions.length === 0) lines.push('Aucune modification effectuée');
  for (const a of report.actions) lines.push(`${ACTION_MARK[a.result]} ${a.title}`);
  lines.push('', 'TEST', report.test || 'Non vérifié', '', 'STATUT', STATUS_LABEL[report.status], '', 'DURÉE', formatDuration(report.durationMs));
  return lines.join('\n');
}
