import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { browserCandidates } from '../browser.js';

/**
 * Fenêtre de l'application technicien : la console Tech Assist (le site, en mode application) dans une fenêtre Edge/Chrome dédiée.
 *  - profil PERSISTANT : la connexion est gardée d'un lancement à l'autre (jeton d'appareil de 30 jours, notifications autorisées) ;
 *  - son autorisé sans clic (--autoplay-policy) : le « ding-dong » sonne même fenêtre réduite ;
 *  - aucune mise en veille de la fenêtre (minuteries, rendu) : la fenêtre réduite reste réactive.
 */
export const TECHNICIAN_WINDOW_SIZE = '1280,860';

export interface TechnicianWindowPlan {
  command: string;
  args: string[];
  profileDir: string;
}

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{1,5}$/;
const REMOTE = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/;

/** Adresse du site : https, ou un serveur local (essais). Tout le reste est refusé. */
export function validSite(site: string): string | null {
  const s = site.replace(/\/+$/, '');
  return LOCAL.test(s) || REMOTE.test(s) ? s : null;
}

export function consoleUrl(site: string): string {
  return `${site}/technicien?app=1`;
}

export function technicianWindowPlan(
  site: string,
  options: { minimized?: boolean; exists?: (path: string) => boolean; env?: NodeJS.ProcessEnv } = {},
): TechnicianWindowPlan | null {
  const valid = validSite(site);
  if (!valid) return null;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const exe = browserCandidates(env).find((p) => exists(p));
  const base = env.LOCALAPPDATA;
  if (!exe || !base) return null;
  const profileDir = join(base, 'TechAssist', 'technicien-profil');
  return {
    command: exe,
    profileDir,
    args: [
      `--app=${consoleUrl(valid)}`,
      `--window-size=${TECHNICIAN_WINDOW_SIZE}`,
      `--user-data-dir=${profileDir}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      ...(options.minimized ? ['--start-minimized'] : []),
    ],
  };
}
