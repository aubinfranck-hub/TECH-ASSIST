import { execFile } from 'node:child_process';

/**
 * Démarrage automatique avec Windows (clé « Run » de l'utilisateur, aucun droit administrateur) : le technicien est alerté dès qu'il
 * ouvre sa session, fenêtre réduite. Il peut le couper dans le Gestionnaire des tâches > Démarrage, ou avec --sans-demarrage-auto.
 */
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const RUN_NAME = 'TechAssistTechnicien';

export type Exec = (file: string, args: string[]) => Promise<{ code: number; stdout: string }>;

const realExec: Exec = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000 }, (err, stdout) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : err ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? '') });
    });
  });

export function autostartCommand(exePath: string): string {
  if (/["\r\n]/.test(exePath)) throw new Error("chemin d'exécutable non valide");
  return `"${exePath}" --minimized`;
}

export async function setAutostart(exePath: string, exec: Exec = realExec): Promise<boolean> {
  const r = await exec('reg', ['add', RUN_KEY, '/v', RUN_NAME, '/t', 'REG_SZ', '/d', autostartCommand(exePath), '/f']);
  return r.code === 0;
}

export async function getAutostart(exec: Exec = realExec): Promise<string | null> {
  const r = await exec('reg', ['query', RUN_KEY, '/v', RUN_NAME]);
  if (r.code !== 0) return null;
  const m = new RegExp(`${RUN_NAME}\\s+REG_SZ\\s+(.+)`, 'i').exec(r.stdout);
  return m ? m[1]!.trim() : null;
}

export async function removeAutostart(exec: Exec = realExec): Promise<boolean> {
  const r = await exec('reg', ['delete', RUN_KEY, '/v', RUN_NAME, '/f']);
  return r.code === 0;
}
