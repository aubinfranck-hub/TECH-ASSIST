import { randomBytes } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Ouverture de la fenêtre de Tech Assist. Sous Windows, Edge (toujours présent) ou Chrome peuvent ouvrir une adresse en
 * « fenêtre d'application » : sans barre d'adresse ni onglets, comme un vrai logiciel. Sans l'un des deux, ou si
 * l'adresse n'est pas locale, on retombe sur le navigateur par défaut.
 */
export interface LaunchPlan {
  command: string;
  args: string[];
  /** Dossier de profil propre à cette fenêtre (aucune extension, aucun compte du client) ; supprimé à la fermeture. */
  profileDir: string;
}

const LOCAL_URL = /^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/\?t=[A-Za-z0-9]+$/;

export const WINDOW_SIZE = '1180,780';

export function browserCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [env['ProgramFiles(x86)'], env['ProgramFiles'], env['LOCALAPPDATA']].filter((r): r is string => !!r);
  const out: string[] = [];
  for (const root of roots) out.push(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  for (const root of roots) out.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return out;
}

/** Fenêtre d'application si un navigateur compatible est installé ; null sinon (le navigateur par défaut prend le relais). */
export function appWindowPlan(
  url: string,
  exists: (path: string) => boolean = existsSync,
  env: NodeJS.ProcessEnv = process.env,
  tmp: string = tmpdir(),
  id: string = randomBytes(6).toString('hex'),
): LaunchPlan | null {
  if (!LOCAL_URL.test(url)) return null;
  const exe = browserCandidates(env).find((p) => exists(p));
  if (!exe) return null;
  // Profil dédié : la fenêtre ne dépend pas du navigateur du client (même lancée avec les droits administrateur) et n'y touche pas.
  const profileDir = join(tmp, `tech-assist-fenetre-${id}`);
  return {
    command: exe,
    args: [`--app=${url}`, `--window-size=${WINDOW_SIZE}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync'],
    profileDir,
  };
}

/** Supprime le profil de la fenêtre (au mieux : le navigateur peut encore le tenir un instant). */
export function cleanupProfile(plan: LaunchPlan | null): void {
  if (!plan || !/tech-assist-fenetre-[0-9a-f]+$/.test(plan.profileDir)) return;
  try {
    rmSync(plan.profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  } catch {
    /* sans importance : dossier temporaire */
  }
}
