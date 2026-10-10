import { describe, expect, it } from 'vitest';
import { appWindowPlan, browserCandidates, cleanupProfile } from '../browser.js';

const env = { 'ProgramFiles(x86)': 'C:\\Program Files (x86)', ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\Awa\\AppData\\Local' } as NodeJS.ProcessEnv;
const URL_OK = 'http://127.0.0.1:51234/?t=abcDEF0123';

describe('fenêtre de Tech Assist (Edge ou Chrome en « fenêtre d\'application »)', () => {
  it('préfère Edge, puis Chrome', () => {
    const list = browserCandidates(env);
    expect(list[0]).toMatch(/Edge/);
    expect(list.findIndex((p) => /chrome/i.test(p))).toBeGreaterThan(list.findIndex((p) => /Edge/.test(p)));
  });

  it("construit la commande avec un profil dédié et sans extension", () => {
    const plan = appWindowPlan(URL_OK, (p) => /msedge/.test(p), env, 'C:\\Temp', 'abc123');
    expect(plan?.command).toMatch(/msedge\.exe$/);
    expect(plan?.args).toContain(`--app=${URL_OK}`);
    expect(plan?.args.some((a) => a.startsWith('--user-data-dir=') && a.includes('tech-assist-fenetre-abc123'))).toBe(true);
    expect(plan?.args).toContain('--disable-extensions');
  });

  it('utilise Chrome si Edge est absent', () => {
    const plan = appWindowPlan(URL_OK, (p) => /chrome/i.test(p), env, 'C:\\Temp', 'x1');
    expect(plan?.command).toMatch(/chrome\.exe$/);
  });

  it('renvoie null sans navigateur compatible : le navigateur par défaut prend le relais', () => {
    expect(appWindowPlan(URL_OK, () => false, env)).toBeNull();
  });

  it("n'ouvre jamais autre chose que l'adresse locale de l'agent", () => {
    for (const bad of ['https://exemple.com/', 'http://127.0.0.1:80/', 'http://127.0.0.1:5/?t=a b', 'file:///C:/x', 'http://evil.test/?t=a', 'http://127.0.0.1:5000/?t=a&--no-sandbox']) {
      expect(appWindowPlan(bad, () => true, env)).toBeNull();
    }
  });

  it("ne supprime que son propre dossier de profil", () => {
    expect(() => cleanupProfile(null)).not.toThrow();
    expect(() => cleanupProfile({ command: 'x', args: [], profileDir: 'C:\\Users\\Awa\\Documents' })).not.toThrow();
  });
});
