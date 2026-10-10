import { z } from 'zod';

/**
 * Avancement des tâches de l'agent (tâche en cours, terminées, à venir). L'agent l'envoie à chaque changement et
 * pendant les longues tâches ; le technicien le lit dans sa console. Les durées sont en secondes.
 */
const taskSchema = z.object({
  id: z.string().max(200),
  title: z.string().max(200),
  state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  /** Durée habituelle de la tâche (minimum et maximum). */
  min: z.number().min(0).max(86_400),
  max: z.number().min(0).max(86_400),
  /** Depuis combien de temps la tâche tourne (tâche en cours seulement). */
  elapsed: z.number().min(0).max(604_800).optional(),
  /** Durée réelle (tâche terminée seulement). */
  seconds: z.number().min(0).max(604_800).optional(),
});

export const progressSchema = z.object({ items: z.array(taskSchema).max(60), complete: z.boolean() });
export type ProgressBody = z.infer<typeof progressSchema>;

export interface ProgressView extends ProgressBody {
  /** Il y a combien de secondes l'agent a donné de ses nouvelles. */
  ageSeconds: number;
}

/** Ce que la console technicien reçoit : l'état enregistré et l'ancienneté de la dernière nouvelle. */
export function progressView(stored: unknown, ageSeconds: unknown): ProgressView | null {
  const parsed = progressSchema.safeParse(stored);
  if (!parsed.success) return null;
  const age = Number(ageSeconds);
  return { ...parsed.data, ageSeconds: Number.isFinite(age) ? Math.max(0, Math.round(age)) : 0 };
}

/** Au-delà, l'agent est considéré sans nouvelles (il en donne toutes les 30 s pendant une tâche) : PC éteint ou hors ligne. */
export const STALE_PROGRESS_SECONDS = 120;
