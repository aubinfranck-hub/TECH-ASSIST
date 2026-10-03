import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkForUpdate, compareVersions, parseManifest } from '../selfUpdate.js';

const fakeExe = (tag: string) => Buffer.concat([Buffer.from('MZ'), Buffer.from(tag), Buffer.alloc(1_100_000, 7)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function setup(opts: { version?: string; remote?: string; tamper?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ta-update-'));
  const exePath = join(dir, 'tech-assist-agent.exe');
  writeFileSync(exePath, fakeExe('old'));
  const next = fakeExe('new');
  const manifest = { version: opts.remote ?? '0.1.60', files: { 'tech-assist-agent.exe': { sha256: sha(next) }, 'tech-assist-agent-console.exe': { sha256: sha(next) } } };
  const served = opts.tamper ? fakeExe('evil') : next;
  const fetchImpl = (async (url: string) => {
    if (String(url).endsWith('latest.json')) return new Response(JSON.stringify(manifest));
    if (String(url).endsWith('tech-assist-agent.exe')) return new Response(served);
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  const relaunched: string[][] = [];
  return { dir, exePath, fetchImpl, relaunched, run: () => checkForUpdate({ currentVersion: opts.version ?? '0.1.50', exePath, args: ['--api', 'x'], fetchImpl, relaunch: (p, a) => relaunched.push([p, ...a]) }) };
}

describe('mise à jour automatique', () => {
  it('compare les versions', () => {
    expect(compareVersions('0.1.60', '0.1.9')).toBe(1);
    expect(compareVersions('0.1.5', '0.1.5')).toBe(0);
    expect(compareVersions('0.2', '0.1.99')).toBe(1);
    expect(compareVersions('abc', '0.1.0')).toBe(0);
  });
  it('refuse un manifeste invalide', () => {
    expect(parseManifest({ version: '1.2', files: { 'a.exe': { sha256: 'zz' } } })).toBeNull();
    expect(parseManifest({ version: '../x', files: {} })).toBeNull();
  });
  it('remplace l\'exe, garde l\'ancien en .old et relance avec --updated', async () => {
    const s = setup();
    const r = await s.run();
    expect(r).toEqual({ status: 'restarting', version: '0.1.60' });
    expect(readFileSync(s.exePath).includes('new')).toBe(true);
    expect(existsSync(`${s.exePath}.old`)).toBe(true);
    expect(s.relaunched[0]).toEqual([s.exePath, '--api', 'x', '--updated']);
  });
  it('déjà à jour : ne touche à rien', async () => {
    const s = setup({ version: '0.1.60' });
    expect((await s.run()).status).toBe('current');
    expect(readFileSync(s.exePath).includes('old')).toBe(true);
  });
  it('empreinte différente : mise à jour refusée, fichier intact', async () => {
    const s = setup({ tamper: true });
    const r = await s.run();
    expect(r.status).toBe('failed');
    expect(readFileSync(s.exePath).includes('old')).toBe(true);
    expect(existsSync(`${s.exePath}.new`)).toBe(false);
    expect(s.relaunched).toHaveLength(0);
  });
  it('version de développement, --no-update et --updated : aucune vérification', async () => {
    const s = setup();
    expect((await checkForUpdate({ currentVersion: 'dev', exePath: s.exePath, fetchImpl: s.fetchImpl })).status).toBe('skipped');
    expect((await checkForUpdate({ currentVersion: '0.1.1', exePath: s.exePath, args: ['--updated'], fetchImpl: s.fetchImpl })).status).toBe('skipped');
    expect((await checkForUpdate({ currentVersion: '0.1.1', exePath: s.exePath, args: ['--no-update'], fetchImpl: s.fetchImpl })).status).toBe('skipped');
  });
  it('hors connexion : l\'agent continue', async () => {
    const r = await checkForUpdate({ currentVersion: '0.1.1', exePath: 'x.exe', fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    expect(r.status).toBe('skipped');
  });
});
