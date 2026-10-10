import { describe, expect, it } from 'vitest';
import { AppApi, joinCompany } from '../appAccount.js';
import { converse } from '../conversation.js';
import { routeIntent } from '../router.js';
import { COLLECT_SCRIPT, parseFleetHealth } from '../skills/fleetStatus.js';
import { Recorder, ScriptedConversation } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const noRunner = { runPowerShell: async () => ({ stdout: '{}', stderr: '', exitCode: 0 }) };

describe('santé du poste (vue de parc)', () => {
  it('calcule disque, mémoire, antivirus et mises à jour', () => {
    const h = parseFleetHealth(JSON.stringify({ diskSizeBytes: 500e9, diskFreeBytes: 50e9, memTotalKb: 8e6, memFreeKb: 2e6, avEnabled: true, lastPatchDaysAgo: 12 }));
    expect(h).toEqual({ diskFreePercent: 10, memoryUsedPercent: 75, antivirusOk: true, osUpToDate: true });
  });
  it('mises à jour : « pas à jour » au-delà de 60 jours ; valeurs absentes ou absurdes ignorées', () => {
    expect(parseFleetHealth(JSON.stringify({ lastPatchDaysAgo: 200 })).osUpToDate).toBe(false);
    expect(parseFleetHealth(JSON.stringify({ diskSizeBytes: 100, diskFreeBytes: 500, memTotalKb: 0 }))).toEqual({});
    expect(parseFleetHealth(JSON.stringify({ avEnabled: null }))).toEqual({});
  });
  it('la collecte est en lecture seule et ne sort aucun nom de fichier ni contenu', () => {
    checkStructure(COLLECT_SCRIPT);
    expect(COLLECT_SCRIPT).not.toMatch(/\b(Set|Start|Stop|Remove|Enable|Disable|Clear|New|Restart|Update|Invoke|Add)-[A-Za-z]/);
    expect(COLLECT_SCRIPT).not.toMatch(/Get-ChildItem|Get-Content|Get-EventLog|Get-WinEvent/);
  });
});

describe('rattachement à une entreprise', () => {
  it('le routeur reconnaît la demande et ne la confond pas avec « parc informatique »', () => {
    for (const m of ['rattacher ce PC à mon entreprise', "j'ai un code de rattachement", 'ajouter ce pc a mon entreprise', 'rejoindre mon entreprise']) {
      expect(routeIntent(m), m).toEqual([{ kind: 'company' }]);
    }
    expect(routeIntent('je veux voir tous les pc').map((i) => i.kind)).toEqual(['human_only']);
  });

  it('avec un compte : demande le code, rattache ce PC et le dit au client', async () => {
    const calls: string[][] = [];
    const ui = new ScriptedConversation({ asks: ['rattacher ce pc à mon entreprise', 'abcde-fghjk', null] });
    await converse({
      runner: noRunner,
      ui,
      reporter: new Recorder(),
      machine: 'PC-COMPTA-04',
      company: { join: async (code, device) => (calls.push([code, device]), { ok: true, companyName: 'Kassy SARL' }) },
    });
    expect(calls).toEqual([['abcde-fghjk', 'PC-COMPTA-04']]);
    expect(ui.said).toContain('Kassy SARL');
    expect(ui.said).toContain('Aucun fichier ni document');
  });

  it('un code refusé par le serveur est expliqué tel quel', async () => {
    const ui = new ScriptedConversation({ asks: ['rattacher ce pc à mon entreprise', 'ABCDE-FGHJK', null] });
    await converse({ runner: noRunner, ui, reporter: new Recorder(), company: { join: async () => ({ ok: false, error: 'Code invalide, expiré ou déjà utilisé.' }) } });
    expect(ui.said).toContain('Code invalide, expiré ou déjà utilisé.');
  });

  it('un code mal formé n’est même pas envoyé au serveur', async () => {
    let called = false;
    const ui = new ScriptedConversation({ asks: ['rattacher ce pc à mon entreprise', 'x', 'y', 'z'] });
    await converse({ runner: noRunner, ui, reporter: new Recorder(), company: { join: async () => ((called = true), { ok: true, companyName: 'X' }) } });
    expect(called).toBe(false);
  });

  it('sans compte : explique comment faire, sans rien envoyer', async () => {
    const ui = new ScriptedConversation({ asks: ['rattacher ce pc à mon entreprise', null] });
    await converse({ runner: noRunner, ui, reporter: new Recorder() });
    expect(ui.said).toContain('connectez-vous');
  });

  it('joinCompany : erreur réseau ou serveur renvoyée en français', async () => {
    const api = new AppApi('https://x.test', (async () => new Response(JSON.stringify({ error: 'Ce PC est déjà rattaché à une entreprise.' }), { status: 409 })) as unknown as typeof fetch);
    expect(await joinCompany(api, 'T', 'ABCDEFGHJK', 'PC')).toEqual({ ok: false, error: 'Ce PC est déjà rattaché à une entreprise.' });
    const down = new AppApi('https://x.test', (async () => {
      throw new Error('x');
    }) as unknown as typeof fetch);
    const r = await joinCompany(down, 'T', 'ABCDEFGHJK', 'PC');
    expect(r.ok).toBe(false);
  });
});
