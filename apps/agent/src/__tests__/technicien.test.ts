import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installShortcuts } from '../shortcuts.js';
import { publishedName } from '../selfUpdate.js';
import { autostartCommand, getAutostart, removeAutostart, RUN_KEY, RUN_NAME, setAutostart, type Exec } from '../technicien/autostart.js';
import { acquireInstanceLock } from '../technicien/instance.js';
import { consoleUrl, technicianWindowPlan, validSite } from '../technicien/window.js';

const env = { LOCALAPPDATA: 'C:\\Users\\Awa\\AppData\\Local', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' };
const isEdge = (p: string) => /msedge\.exe$/.test(p);

describe('fenêtre de l’application technicien', () => {
  it('ouvre la console en mode application, profil persistant, son autorisé sans clic, aucune mise en veille', () => {
    const plan = technicianWindowPlan('https://tech-assist-web.onrender.com', { env, exists: isEdge })!;
    expect(plan.command).toMatch(/msedge\.exe$/);
    expect(plan.args).toContain('--app=https://tech-assist-web.onrender.com/technicien?app=1');
    expect(plan.args).toContain('--autoplay-policy=no-user-gesture-required');
    expect(plan.args).toContain('--disable-background-timer-throttling');
    expect(plan.args).toContain('--disable-renderer-backgrounding');
    expect(plan.profileDir).toBe(join(env.LOCALAPPDATA, 'TechAssist', 'technicien-profil'));
    expect(plan.args.some((a) => a === `--user-data-dir=${plan.profileDir}`)).toBe(true);
    expect(plan.args).not.toContain('--start-minimized');
    expect(technicianWindowPlan('https://tech-assist-web.onrender.com', { env, exists: isEdge, minimized: true })!.args).toContain('--start-minimized');
  });
  it('sans Edge ni Chrome : pas de plan (le navigateur par défaut prend le relais)', () => {
    expect(technicianWindowPlan('https://x.example', { env, exists: () => false })).toBeNull();
  });
  it('refuse une adresse non sûre (http distant, caractères spéciaux, autre protocole)', () => {
    for (const bad of ['http://evil.example', 'https://a.b/ --remote-debugging-port=1', 'file:///c:/x', 'javascript:alert(1)', 'https://exemple.com@evil.com']) {
      expect(validSite(bad)).toBeNull();
      expect(technicianWindowPlan(bad, { env, exists: () => true })).toBeNull();
    }
    expect(validSite('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173');
    expect(validSite('https://tech-assist-web.onrender.com/')).toBe('https://tech-assist-web.onrender.com');
    expect(consoleUrl('https://x.example')).toBe('https://x.example/technicien?app=1');
  });
});

describe('démarrage automatique avec Windows', () => {
  function fakeReg() {
    const calls: string[][] = [];
    let stored: string | null = null;
    const exec: Exec = async (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === 'add') {
        stored = args[args.indexOf('/d') + 1]!;
        return { code: 0, stdout: '' };
      }
      if (args[0] === 'query') return stored ? { code: 0, stdout: `\r\n${RUN_KEY}\r\n    ${RUN_NAME}    REG_SZ    ${stored}\r\n` } : { code: 1, stdout: '' };
      if (args[0] === 'delete') {
        const had = stored !== null;
        stored = null;
        return { code: had ? 0 : 1, stdout: '' };
      }
      return { code: 1, stdout: '' };
    };
    return { exec, calls };
  }
  it('écrit, relit et supprime la commande, fenêtre réduite, sans passer par un shell', async () => {
    const { exec, calls } = fakeReg();
    const exe = 'C:\\Users\\Awa\\AppData\\Local\\TechAssist\\tech-assist-technicien.exe';
    expect(await setAutostart(exe, exec)).toBe(true);
    expect(await getAutostart(exec)).toBe(`"${exe}" --minimized`);
    expect(await removeAutostart(exec)).toBe(true);
    expect(await getAutostart(exec)).toBeNull();
    expect(calls.every((c) => c[0] === 'reg')).toBe(true);
  });
  it('refuse un chemin avec guillemet ou retour à la ligne', () => {
    expect(() => autostartCommand('C:\\a"b.exe')).toThrow();
    expect(() => autostartCommand('C:\\a\nb.exe')).toThrow();
  });
});

describe('un seul exemplaire à la fois', () => {
  it('le second exemplaire est refusé tant que le premier est ouvert, puis accepté', async () => {
    const first = await acquireInstanceLock(47391);
    expect(first).not.toBeNull();
    expect(await acquireInstanceLock(47391)).toBeNull();
    await first!.release();
    const again = await acquireInstanceLock(47391);
    expect(again).not.toBeNull();
    await again!.release();
  });
});

describe('mise à jour et raccourcis de l’application technicien', () => {
  it('le fichier technicien se met à jour avec SA version, même renommé par le navigateur', () => {
    expect(publishedName('tech-assist-technicien.exe')).toBe('tech-assist-technicien.exe');
    expect(publishedName('tech-assist-technicien (2).exe')).toBe('tech-assist-technicien.exe');
    expect(publishedName('tech-assist-agent.exe')).toBe('tech-assist-agent.exe');
    expect(publishedName('tech-assist-agent-console.exe')).toBe('tech-assist-agent-console.exe');
  });
  it('crée ses raccourcis « Tech Assist Technicien » (marqueur distinct de celui du client)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ta-tech-'));
    const exe = join(root, 'tech-assist-technicien.exe');
    await writeFile(exe, 'exe');
    const made: string[] = [];
    const out = await installShortcuts({ platform: 'win32', exePath: exe, version: '0.1.50', env: { LOCALAPPDATA: join(root, 'local') }, makeLinks: async (target) => void made.push(target) });
    expect(out.status).toBe('installed');
    expect(made[0]).toBe(join(root, 'local', 'TechAssist', 'tech-assist-technicien.exe'));
    // Le raccourci du client (autre marqueur) reste possible à côté.
    const client = join(root, 'tech-assist-agent.exe');
    await writeFile(client, 'exe');
    expect((await installShortcuts({ platform: 'win32', exePath: client, version: '0.1.50', env: { LOCALAPPDATA: join(root, 'local') }, makeLinks: async () => undefined })).status).toBe('installed');
  });
});
