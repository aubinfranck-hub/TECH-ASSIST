import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { installShortcuts } from '../shortcuts.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ta-sc-'));
  const exe = join(root, 'tech-assist-agent.exe');
  await writeFile(exe, 'exe');
  return { root, exe, env: { LOCALAPPDATA: join(root, 'local') } as NodeJS.ProcessEnv };
}

describe('raccourci Tech Assist au premier lancement', () => {
  it("copie l'exécutable dans le dossier utilisateur, crée les raccourcis une seule fois", async () => {
    const { root, exe, env } = await setup();
    const calls: string[] = [];
    const make = async (t: string) => void calls.push(t);
    const first = await installShortcuts({ platform: 'win32', exePath: exe, version: '0.1.60', env, makeLinks: make });
    expect(first.status).toBe('installed');
    expect(calls).toEqual([join(root, 'local', 'TechAssist', 'tech-assist-agent.exe')]);
    expect(await readFile(calls[0]!, 'utf8')).toBe('exe');
    // Le client a supprimé le raccourci : il ne revient pas.
    expect((await installShortcuts({ platform: 'win32', exePath: exe, version: '0.1.60', env, makeLinks: make })).status).toBe('skipped');
    expect(calls).toHaveLength(1);
  });

  it('ne fait rien hors Windows, en développement, ou pour un exécutable inattendu', async () => {
    const { root, exe, env } = await setup();
    const make = async () => { throw new Error('ne doit pas être appelé'); };
    expect((await installShortcuts({ platform: 'linux', exePath: exe, version: '0.1.1', env, makeLinks: make })).status).toBe('skipped');
    expect((await installShortcuts({ platform: 'win32', exePath: exe, version: 'dev', env, makeLinks: make })).status).toBe('skipped');
    expect((await installShortcuts({ platform: 'win32', exePath: join(root, 'node.exe'), version: '0.1.1', env, makeLinks: make })).status).toBe('skipped');
    await expect(stat(join(root, 'local'))).rejects.toThrow();
  });

  it('une erreur de création ne bloque jamais le démarrage', async () => {
    const { exe, env } = await setup();
    const out = await installShortcuts({ platform: 'win32', exePath: exe, version: '0.1.2', env, makeLinks: async () => { throw new Error('boom'); } });
    expect(out.status).toBe('skipped');
  });
});
