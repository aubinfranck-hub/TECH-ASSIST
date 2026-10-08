import { describe, expect, it, vi } from 'vitest';
import { RUSTDESK_WINDOWS, buildPrepareScript, checkSettings, encodeServerConfig, parsePeerId, shareScreen, type Remote } from '../remoteAccess.js';
import type { CommandRunner } from '../types.js';

const KEY = 'A'.repeat(43) + '=';
const custom = { custom: true as const, idServer: 'remote.techassist.ci', relayServer: 'remote.techassist.ci', key: KEY };

function setup(opts: { pick?: number | null; run?: { stdout: string; stderr?: string; exitCode: number }; settings?: Awaited<ReturnType<Remote['settings']>>; shareOk?: boolean } = {}) {
  const info: string[] = [];
  const ui = { info: (t: string) => void info.push(t), choose: vi.fn(async () => (opts.pick === undefined ? 0 : opts.pick)) };
  const scripts: string[] = [];
  const runner: CommandRunner = {
    runPowerShell: async (script) => {
      scripts.push(script);
      return { stderr: '', ...(opts.run ?? { stdout: 'TECHASSIST_ID=123456789\n', exitCode: 0 }) };
    },
  };
  const shared: [string, string][] = [];
  const remote: Remote = {
    settings: async () => opts.settings ?? { custom: false },
    share: async (id, pw) => {
      shared.push([id, pw]);
      return opts.shareOk ?? true;
    },
  };
  return { ui, info, runner, remote, scripts, shared };
}

describe('Partage d’écran avec le technicien', () => {
  it('avec l’accord du client : prépare RustDesk et envoie identifiant + mot de passe au serveur', async () => {
    const t = setup();
    const result = await shareScreen({ ui: t.ui, runner: t.runner, remote: t.remote, password: () => 'abcDEF1234' });
    expect(result).toBe('shared');
    expect(t.shared).toEqual([['123456789', 'abcDEF1234']]);
    expect(t.scripts[0]).toContain(RUSTDESK_WINDOWS.sha256);
    expect(t.scripts[0]).toContain("--password 'abcDEF1234'");
    expect(t.info.join(' ')).toContain('Accepter');
  });

  it('sans accord du client : rien n’est téléchargé ni exécuté', async () => {
    const t = setup({ pick: 1 });
    expect(await shareScreen({ ui: t.ui, runner: t.runner, remote: t.remote })).toBe('declined');
    expect(t.scripts).toHaveLength(0);
    expect(t.shared).toHaveLength(0);
  });

  it('fenêtre fermée (aucune réponse) : pas de partage', async () => {
    const t = setup({ pick: null });
    expect(await shareScreen({ ui: t.ui, runner: t.runner, remote: t.remote })).toBe('declined');
    expect(t.scripts).toHaveLength(0);
  });

  it('offre sans technicien : ne propose rien', async () => {
    const t = setup({ settings: { error: 'not_included' } });
    expect(await shareScreen({ ui: t.ui, runner: t.runner, remote: t.remote })).toBe('not_included');
    expect(t.ui.choose).not.toHaveBeenCalled();
  });

  it('échec de la préparation : le dit honnêtement et n’envoie rien au serveur', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const t = setup({ run: { stdout: '', stderr: 'Vérification de l outil échouée', exitCode: 1 } });
    expect(await shareScreen({ ui: t.ui, runner: t.runner, remote: t.remote })).toBe('failed');
    expect(t.shared).toHaveLength(0);
    expect(t.info.join(' ')).toContain("pas réussi");
  });

  it('serveur qui n’enregistre pas la connexion : échec signalé', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const t = setup({ shareOk: false });
    expect(await shareScreen({ ui: t.ui, runner: t.runner, remote: t.remote })).toBe('failed');
  });

  it('installe RustDesk en service (le mot de passe n’est pas applicable en mode portable) et vérifie le résultat', () => {
    const script = buildPrepareScript({ custom: false }, 'abcDEF1234');
    expect(script).toContain('--silent-install');
    expect(script).toContain('ADMIN_REQUIRED');
    expect(script).toContain("--password 'abcDEF1234'");
    expect(script).toMatch(/required\|denied/); // la réponse de RustDesk est lue, plus ignorée
    expect(script).not.toContain('--config');
  });

  it('les chemins et expressions du script rendu sont intacts (antislashs)', () => {
    const script = buildPrepareScript({ custom: false }, 'abcDEF1234');
    expect(script).toContain("'TechAssist\\rustdesk'");
    expect(script).toContain("'RustDesk\\rustdesk.exe'");
    expect(script).toContain("'^\\d{6,12}$'");
    expect(script).not.toMatch(/[\r\f\v]/);
  });

  it('serveur auto-hébergé : le serveur est importé avec --config ; la chaîne se décode en {host, relay, key}', () => {
    const script = buildPrepareScript(custom, 'abcDEF1234');
    const encoded = encodeServerConfig(custom);
    expect(script).toContain(`--config '${encoded}'`);
    const decoded = JSON.parse(Buffer.from(encoded.split('').reverse().join(''), 'base64').toString('utf8'));
    expect(decoded).toEqual({ host: custom.idServer, relay: custom.relayServer, key: custom.key, api: '' });
  });

  it('droits administrateur manquants : message clair, rien envoyé au serveur', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const t = setup({ run: { stdout: '', stderr: 'ADMIN_REQUIRED', exitCode: 1 } });
    expect(await shareScreen({ ui: t.ui, runner: t.runner, remote: t.remote })).toBe('failed');
    expect(t.info.join(' ')).toContain('administrateur');
    expect(t.shared).toHaveLength(0);
  });

  it('refuse les réglages du réseau qui pourraient injecter du code dans le script', () => {
    expect(checkSettings({ custom: true, idServer: "x'; calc; '", relayServer: 'ok.example.com', key: KEY })).toBeNull();
    expect(checkSettings({ custom: true, idServer: 'ok.example.com', relayServer: 'ok.example.com', key: "k'; calc; '" + KEY })).toBeNull();
    expect(checkSettings({ custom: true, idServer: 'ok.example.com', relayServer: 'ok.example.com', key: KEY })).not.toBeNull();
    expect(checkSettings({ custom: false })).toEqual({ custom: false });
    expect(() => buildPrepareScript({ custom: false }, "x'; calc")).toThrow();
  });

  it('lit l’identifiant dans la sortie du script', () => {
    expect(parsePeerId('bruit\nTECHASSIST_ID=987654321\n')).toBe('987654321');
    expect(parsePeerId('rien')).toBeNull();
  });
});
