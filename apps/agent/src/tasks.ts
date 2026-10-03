import type { Action } from './types.js';

/**
 * Suivi des tâches affiché dans la fenêtre du client : ce que l'agent fait en ce moment, depuis combien de temps,
 * et la durée habituelle de cette tâche. Les durées sont des ordres de grandeur (secondes, minimum et maximum) :
 * elles servent à rassurer le client, pas à promettre une heure de fin.
 */
export interface TaskInfo {
  id: string;
  title: string;
  /** Durée habituelle, en secondes (minimum et maximum). */
  min: number;
  max: number;
}

export type TaskResult = 'done' | 'failed' | 'skipped';

/** Ce que l'agent annonce à la fenêtre ; les interfaces sans fenêtre (terminal) n'en ont pas. */
export interface TaskTracker {
  /** Tâches prévues (en attente) : elles comptent dans le temps restant. Une tâche déjà connue n'est pas dupliquée. */
  plan(items: TaskInfo[]): void;
  start(item: TaskInfo): void;
  end(id: string, result: TaskResult): void;
  /** Plus rien n'est prévu : les tâches restées en attente (finalement inutiles) sont retirées. */
  settle(): void;
}

const MIN = 60;

/** Durées habituelles par action (secondes). Les plus longues reprennent ce qui est annoncé au client dans l'explication de l'action. */
const ESTIMATES: Record<string, [number, number]> = {
  restore_point: [15, 90],
  dism_restore_health: [10 * MIN, 40 * MIN],
  sfc_scan: [10 * MIN, 30 * MIN],
  repair_volume: [2 * MIN, 15 * MIN],
  component_cleanup: [2 * MIN, 10 * MIN],
  clean_temp: [30, 3 * MIN],
  clear_browser_cache: [10, 90],
  empty_recycle_bin: [5, 60],
  clean_system_caches: [30, 4 * MIN],
  disable_startup_apps: [5, 45],
  set_balanced_power: [2, 15],
  update_signatures: [30, 3 * MIN],
  quick_scan: [5 * MIN, 20 * MIN],
  remove_threats: [30, 5 * MIN],
  enable_realtime: [5, 30],
  enable_firewall: [5, 30],
  renew_ip: [5, 40],
  flush_dns: [2, 15],
  reset_network_stack: [10, 90],
  restart_adapter: [5, 40],
  enable_adapter: [5, 40],
  reset_dns_servers: [3, 20],
  disable_proxy: [2, 15],
  repair_office: [5 * MIN, 30 * MIN],
  outlook_safe_mode: [5, 30],
  install_app: [MIN, 10 * MIN],
  uninstall_program: [30, 5 * MIN],
  teams_clear_cache: [10, MIN],
  onedrive_reset: [30, 3 * MIN],
  print_test_page: [5, 30],
  clear_print_queue: [5, 30],
  rescan_devices: [10, 60],
  restart_device: [5, 40],
  enable_device: [5, 40],
  // Procédures apprises (procedures/manifest.ts)
  service_start: [3, 30],
  service_restart: [5, 45],
  service_set_startup: [2, 15],
  process_stop: [2, 20],
  explorer_restart: [3, 20],
  explorer_caches: [5, 40],
};

const DEFAULT_ESTIMATE: [number, number] = [5, MIN];

export function estimateFor(actionId: string): [number, number] {
  const base = actionId.split(':')[0]!;
  return ESTIMATES[actionId] ?? ESTIMATES[base] ?? DEFAULT_ESTIMATE;
}

/** Identifiant stable d'une action : le même que celui utilisé par l'agent pour ne jamais reproposer une action déjà tentée. */
export const actionTaskId = (a: Pick<Action, 'id' | 'title'>) => `${a.id}|${a.title}`;

export function taskInfoFor(action: Pick<Action, 'id' | 'title'>): TaskInfo {
  const [min, max] = estimateFor(action.id);
  return { id: actionTaskId(action), title: action.title, min, max };
}

/** Les tâches d'un lot d'actions, point de restauration compris (une seule fois), dans l'ordre où elles seront faites. */
export function plannedTasks(actions: Action[]): TaskInfo[] {
  const out: TaskInfo[] = [];
  const seen = new Set<string>();
  const add = (a: Action) => {
    const info = taskInfoFor(a);
    if (!seen.has(info.id)) {
      seen.add(info.id);
      out.push(info);
    }
  };
  for (const a of actions) {
    if (a.prepare) add(a.prepare);
    add(a);
  }
  return out;
}

export const SCAN_TASK: TaskInfo = { id: 'phase:scan', title: 'Analyse de votre ordinateur', min: 60, max: 150 };
export const RESCAN_TASK: TaskInfo = { id: 'phase:rescan', title: 'Vérification finale', min: 60, max: 150 };
export const DIAGNOSE_TASK = (title: string): TaskInfo => ({ id: `phase:diagnose:${title}`, title: `Analyse : ${title}`, min: 5, max: 45 });
export const VERIFY_TASK = (title: string): TaskInfo => ({ id: `phase:verify:${title}`, title: `Vérification : ${title}`, min: 5, max: 45 });

/** Exécute `work` en l'annonçant comme une tâche ; la tâche est close quoi qu'il arrive. `ok` décide si le résultat est un succès. */
export async function tracked<T>(ui: { tasks?: TaskTracker }, info: TaskInfo, work: () => Promise<T>, ok: (result: T) => boolean = () => true): Promise<T> {
  ui.tasks?.start(info);
  try {
    const result = await work();
    ui.tasks?.end(info.id, ok(result) ? 'done' : 'failed');
    return result;
  } catch (err) {
    ui.tasks?.end(info.id, 'failed');
    throw err;
  }
}
