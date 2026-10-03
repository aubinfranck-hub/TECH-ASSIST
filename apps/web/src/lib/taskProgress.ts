/**
 * Avancement de l'intervention de l'agent, tel que le technicien le lit dans sa console : tâche en cours, temps écoulé,
 * durée habituelle, reste estimé. Les durées sont des ordres de grandeur (secondes), pas des promesses.
 */
export interface ProgressTask {
  id: string;
  title: string;
  state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  /** Durée habituelle de la tâche. */
  min: number;
  max: number;
  /** Depuis combien de temps elle tourne, au moment de la dernière nouvelle de l'agent. */
  elapsed?: number;
  /** Durée réelle d'une tâche terminée. */
  seconds?: number;
}

export interface Progress {
  items: ProgressTask[];
  /** L'agent a conclu son intervention (et pas seulement une tâche). */
  complete: boolean;
  /** Il y a combien de secondes l'agent a donné de ses nouvelles. */
  ageSeconds: number;
}

/** L'agent donne des nouvelles toutes les 30 s pendant une tâche : au-delà de 2 min de silence, le PC est éteint ou hors ligne. */
export const STALE_SECONDS = 120;

export function formatDuration(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec} s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r}` : `${h} h`;
}

/** Chronomètre « 3:07 ». */
export function clock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const r = sec % 60;
  return `${Math.floor(sec / 60)}:${r < 10 ? '0' : ''}${r}`;
}

/** Fourchette lisible : « 10 à 40 min », « 15 s à 2 min ». */
export function usualRange(min: number, max: number): string {
  if (max < 60) return `${Math.round(min)} à ${Math.round(max)} s`;
  if (min >= 60) {
    const a = Math.round(min / 60);
    const b = Math.round(max / 60);
    return a === b ? `${a} min` : `${a} à ${b} min`;
  }
  return `${formatDuration(min)} à ${formatDuration(max)}`;
}

export interface Summary {
  running: ProgressTask | null;
  /** Prochaine tâche quand aucune ne tourne. */
  next: ProgressTask | null;
  /** Temps écoulé sur la tâche en cours (figé au dernier relevé si l'agent ne répond plus). */
  elapsed: number;
  /** Plus long que la durée habituelle maximale. */
  late: boolean;
  /** L'agent ne donne plus de nouvelles alors qu'une tâche était en cours. */
  stale: boolean;
  allDone: boolean;
  /** Tâches comptées (hors « inutiles »), rang de la tâche courante, tâches non réussies. */
  count: number;
  position: number;
  failed: number;
  /** Progression pondérée par les durées habituelles, 0 à 100. */
  percent: number;
  /** Temps restant estimé (fourchette) ; null quand tout est fait. */
  remaining: { low: number; high: number } | null;
  /** Temps réellement passé sur les tâches terminées. */
  spent: number;
}

/**
 * `extra` : secondes écoulées depuis la réception de l'état (la console le rafraîchit toutes les 3 s, le chronomètre avance chaque seconde).
 * `live` : l'assistance est encore ouverte ; sinon une tâche « en cours » est en réalité interrompue.
 */
export function summarize(progress: Progress, extra = 0, live = true): Summary {
  const counted = progress.items.filter((t) => t.state !== 'skipped');
  const running = counted.find((t) => t.state === 'running') ?? null;
  const pending = counted.filter((t) => t.state === 'pending');
  const finished = counted.filter((t) => t.state === 'done' || t.state === 'failed');
  const age = progress.ageSeconds + extra;
  const stale = !!running && (!live || age > STALE_SECONDS);
  const mid = (t: ProgressTask) => (t.min + t.max) / 2;

  const elapsed = running ? (running.elapsed ?? 0) + (stale ? 0 : age) : 0;
  let total = 0;
  let got = 0;
  let low = 0;
  let high = 0;
  let spent = 0;
  for (const t of counted) total += mid(t);
  for (const t of finished) {
    got += mid(t);
    spent += t.seconds ?? 0;
  }
  for (const t of pending) {
    low += t.min;
    high += t.max;
  }
  if (running) {
    got += Math.min(elapsed, mid(running) * 0.95);
    low += Math.max(0, running.min - elapsed);
    high += Math.max(0, running.max - elapsed);
  }
  const allDone = !running && pending.length === 0;
  const percent = allDone && progress.complete ? 100 : total > 0 ? Math.min(97, Math.round((got / total) * 100)) : 0;
  return {
    running,
    next: running ? null : (pending[0] ?? null),
    elapsed,
    late: !!running && elapsed > running.max,
    stale,
    allDone,
    count: counted.length,
    position: Math.min(counted.length, finished.length + 1),
    failed: finished.filter((t) => t.state === 'failed').length,
    percent,
    remaining: allDone ? null : { low, high },
    spent,
  };
}
