import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DEFAULT_SITE } from './chatServer.js';
import { notifyFatal } from './fatal.js';
import { AGENT_VERSION, checkForUpdate, cleanupOldVersion } from './selfUpdate.js';
import { installShortcuts } from './shortcuts.js';
import { autostartCommand, getAutostart, removeAutostart, setAutostart } from './technicien/autostart.js';
import { acquireInstanceLock, INSTANCE_PORT } from './technicien/instance.js';
import { consoleUrl, technicianWindowPlan, validSite } from './technicien/window.js';

/**
 * Tech Assist TECHNICIEN (Windows). Même idée qu'AnyDesk ou TeamViewer côté technicien : un programme qui s'ouvre, reste connecté, et alerte
 * (ding-dong + notification) dès qu'un client demande de l'aide — pour TOUS les techniciens en même temps ; le premier qui prend la demande
 * l'obtient. Il ouvre la console Tech Assist dans une fenêtre dédiée (voir technicien/window.ts), garde la connexion d'un lancement à
 * l'autre, démarre avec Windows et se met à jour tout seul.
 *
 * Codes de sortie : 0 normal · 2 système non pris en charge · 3 déjà ouvert · 4 auto-contrôle en échec.
 */

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Auto-contrôle (fabrication automatique sous Windows) : vérifie, pour de vrai, ce que le programme fait sur le poste. */
async function selfTest(): Promise<number> {
  const results: { name: string; ok: boolean; detail?: string }[] = [];
  const check = async (name: string, fn: () => Promise<string | void>) => {
    try {
      results.push({ name, ok: true, detail: (await fn()) || undefined });
    } catch (err) {
      results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  };
  await check('un seul exemplaire à la fois', async () => {
    const a = await acquireInstanceLock(47299);
    if (!a) throw new Error('verrou refusé');
    const b = await acquireInstanceLock(47299);
    if (b) throw new Error('deuxième exemplaire accepté');
    await a.release();
    const c = await acquireInstanceLock(47299);
    if (!c) throw new Error('verrou non libéré');
    await c.release();
  });
  await check('démarrage avec Windows (clé Run, aller-retour réel)', async () => {
    const probe = join(process.env.LOCALAPPDATA ?? 'C:\\', 'TechAssist', 'tech-assist-technicien.exe');
    if (!(await setAutostart(probe))) throw new Error('écriture refusée');
    const value = await getAutostart();
    if (value !== autostartCommand(probe)) throw new Error(`relu : ${value}`);
    if (!(await removeAutostart())) throw new Error('suppression refusée');
    if ((await getAutostart()) !== null) throw new Error('encore présent après suppression');
  });
  await check('navigateur de la fenêtre (Edge ou Chrome)', async () => {
    const plan = technicianWindowPlan(validSite(arg('site') ?? DEFAULT_SITE) ?? DEFAULT_SITE);
    if (!plan) throw new Error('ni Edge ni Chrome trouvé');
    return plan.command;
  });
  console.log(JSON.stringify({ version: AGENT_VERSION, results }, null, 2));
  return results.every((r) => r.ok) ? 0 : 4;
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.error("Tech Assist Technicien fonctionne uniquement sous Windows.");
    process.exit(2);
  }
  if (flag('selftest')) process.exit(await selfTest());

  await cleanupOldVersion();
  const update = await checkForUpdate().catch(() => ({ status: 'skipped' as const, reason: 'erreur' }));
  if (update.status === 'restarting') process.exit(0);

  const lock = await acquireInstanceLock(flag('test-port') ? Number(arg('test-port')) : INSTANCE_PORT);
  if (!lock) {
    console.error('Tech Assist Technicien est déjà ouvert.');
    process.exit(3);
  }
  // Mode d'essai de la fabrication : garde le verrou un moment, sans ouvrir de fenêtre.
  if (flag('hold')) {
    await new Promise((r) => setTimeout(r, Number(arg('hold')) || 10_000));
    await lock.release();
    process.exit(0);
  }

  const site = validSite(process.env.TECH_ASSIST_SITE ?? arg('site') ?? DEFAULT_SITE);
  if (!site) throw new Error("adresse du site non valide (https obligatoire)");

  // Installation douce (copie dans %LOCALAPPDATA%\TechAssist + raccourcis) ; le démarrage automatique vise la copie installée, qui se met à jour seule.
  const installed = await installShortcuts({ version: AGENT_VERSION }).catch(() => ({ status: 'skipped' as const }));
  if (!flag('sans-demarrage-auto') && process.env.TECH_ASSIST_NO_AUTOSTART !== '1') {
    const target = installed.status === 'installed' ? installed.target : process.execPath;
    await setAutostart(target).catch(() => false);
  }

  const plan = technicianWindowPlan(site, { minimized: flag('minimized') });
  if (!plan) {
    // Ni Edge ni Chrome (très rare) : navigateur par défaut ; le son demandera alors un clic.
    spawn('cmd', ['/c', 'start', '', consoleUrl(site)], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    await lock.release();
    process.exit(0);
  }
  const child = spawn(plan.command, plan.args, { stdio: 'ignore' });
  child.on('error', async (err) => {
    notifyFatal(err);
    await lock.release();
    process.exit(1);
  });
  // Fenêtre fermée = le technicien se met hors ligne : le programme s'arrête avec elle (il suffit de la réduire pour rester en alerte).
  child.on('exit', async () => {
    await lock.release();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  notifyFatal(err);
  process.exit(1);
});
