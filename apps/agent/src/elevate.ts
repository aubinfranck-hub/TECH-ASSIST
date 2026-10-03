import { spawn, spawnSync } from 'node:child_process';

/**
 * Droits administrateur : la plupart des réparations (services, fichiers système, nettoyage) les exigent.
 * Au lancement, si l'agent n'est pas administrateur, il se relance une fois avec la demande de Windows
 * (fenêtre « Contrôle de compte d'utilisateur ») : le client voit et accepte lui-même, rien n'est contourné.
 */

/** Vrai si le processus tourne en administrateur (`net session` n'aboutit qu'avec ce droit). */
export function isAdmin(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    return spawnSync('net', ['session'], { stdio: 'ignore', windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

/** Valeur entre apostrophes pour PowerShell ; null si elle contient quelque chose d'inattendu. */
export function quoteForPowerShell(value: string): string | null {
  if (/[\u0000-\u001f\u007f-\u009f‘’‚‛“”„`$]/.test(value)) return null;
  return `'${value.replace(/'/g, "''")}'`;
}

/** Commande PowerShell qui relance l'agent en administrateur, ou null si les paramètres ne sont pas sûrs. */
export function elevationCommand(execPath: string, argv: string[]): string | null {
  const isNode = /(^|[\\/])node(\.exe)?$/i.test(execPath);
  const args = [...(isNode ? argv.slice(1) : argv.slice(2)), '--elevated'];
  const file = quoteForPowerShell(execPath);
  const quotedArgs = args.map(quoteForPowerShell);
  if (!file || quotedArgs.some((a) => a === null)) return null;
  return `Start-Process -FilePath ${file} -ArgumentList @(${quotedArgs.join(',')}) -Verb RunAs`;
}

/**
 * Relance l'agent en administrateur si nécessaire. Renvoie true quand une nouvelle instance a été lancée
 * (l'instance actuelle doit alors se terminer) ; false pour continuer ici (déjà administrateur, refus, ou impossible).
 */
export async function relaunchAsAdminIfNeeded(argv: string[], execPath = process.execPath): Promise<boolean> {
  if (process.platform !== 'win32' || argv.includes('--elevated') || argv.includes('--no-elevate') || isAdmin()) return false;
  const command = elevationCommand(execPath, argv);
  if (!command) return false;
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      stdio: 'ignore',
      windowsHide: true,
    });
    // Code 0 : l'utilisateur a accepté et la nouvelle instance est lancée ; sinon (refus), on continue sans droits.
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
