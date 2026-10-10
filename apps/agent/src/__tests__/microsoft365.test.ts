import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { routeIntent } from '../router.js';
import { resolveSkill } from '../skills/index.js';
import {
  LICENCE_COLLECT_SCRIPT,
  ONEDRIVE_COLLECT_SCRIPT,
  TEAMS_COLLECT_SCRIPT,
  diagnoseLicence,
  diagnoseOneDrive,
  diagnoseTeams,
  oneDriveSkill,
  parseLicenceFacts,
  teamsSkill,
} from '../skills/microsoft365.js';
import { Recorder, ScriptedConversation, ok } from './fakeScripts.js';
import type { CommandResult, CommandRunner } from '../types.js';
import { checkStructure } from './structure.js';

/** Machine simulée : renvoie l'état de départ puis l'état d'arrivée une fois l'action (script contenant `marker`) passée. */
function machine(marker: string, before: string, after: string) {
  const calls: string[] = [];
  let acted = false;
  const runner: CommandRunner = {
    async runPowerShell(script: string): Promise<CommandResult> {
      calls.push(script);
      if (script.includes(marker)) {
        acted = true;
        return { stdout: 'OK', stderr: '', exitCode: 0 };
      }
      return { stdout: acted ? after : before, stderr: '', exitCode: 0 };
    },
  };
  return { runner, calls };
}

describe('Teams', () => {
  it('absent : le dit, sans proposer d’action', () => {
    expect(diagnoseTeams({ kind: null, running: false, responding: true, cacheMb: 0 })).toMatchObject({ problems: ['teams_missing'], actions: [] });
  });

  it('bloqué : propose de le fermer puis de vider le cache', () => {
    const d = diagnoseTeams({ kind: 'new', running: true, responding: false, cacheMb: 300 });
    expect(d.actions.map((a) => a.id)).toEqual(['teams_close', 'teams_clear_cache']);
  });

  it('aucun signe : propose quand même le vidage du cache, en expliquant que rien n’est perdu', () => {
    const d = diagnoseTeams({ kind: 'classic', running: false, responding: true, cacheMb: 10 });
    expect(d.healthy).toBe(false);
    expect(d.actions).toHaveLength(1);
    expect(d.actions[0]!.explanation).toMatch(/messages.*ne sont pas touchés/);
  });

  it('après le vidage : sain', () => {
    expect(diagnoseTeams({ kind: 'new', running: false, responding: true, cacheMb: 0 }, { cleared: true }).healthy).toBe(true);
  });

  it('parcours complet : accord, vidage, relecture, confirmation', async () => {
    const { runner, calls } = machine('Remove-Item', '{"kind":"new","running":true,"responding":true,"cacheMb":50}', '{"kind":"new","running":false,"responding":true,"cacheMb":0}');
    const ui = new ScriptedConversation();
    const out = await runSkill(teamsSkill(), { runner, ui, reporter: new Recorder() });
    expect(out.status).toBe('fixed');
    const clear = calls.find((c) => c.includes('Remove-Item'))!;
    expect(clear).toContain('MSTeams_8wekyb3d8bbwe');
    expect(clear).toContain('Remove-Item');
    checkStructure(clear);
  });

  it('scripts bien formés', () => {
    checkStructure(TEAMS_COLLECT_SCRIPT);
    checkStructure(ONEDRIVE_COLLECT_SCRIPT);
    checkStructure(LICENCE_COLLECT_SCRIPT);
  });
});

describe('OneDrive', () => {
  it('absent : passe la main', () => {
    expect(diagnoseOneDrive({ installed: false, running: false, diskFreeGb: 50 })).toMatchObject({ needsHuman: true, actions: [] });
  });
  it('arrêté : propose de le démarrer (et pas de réinitialiser)', () => {
    expect(diagnoseOneDrive({ installed: true, running: false, diskFreeGb: 50 }).actions.map((a) => a.id)).toEqual(['onedrive_start']);
  });
  it('disque presque plein : conseil, car c’est la vraie cause', () => {
    const d = diagnoseOneDrive({ installed: true, running: true, diskFreeGb: 0.5 });
    expect(d.advice.join(' ')).toMatch(/place/);
  });
  it('en marche, bloqué : réinitialisation qui ne supprime aucun fichier', () => {
    const d = diagnoseOneDrive({ installed: true, running: true, diskFreeGb: 50 });
    const reset = d.actions.find((a) => a.id === 'onedrive_reset')!;
    expect(reset.explanation).toMatch(/Aucun fichier n'est supprimé/);
    expect(reset.verified).toBe(false);
  });
  it('réinitialisation lancée via le programme OneDrive officiel uniquement', async () => {
    const state = '{"installed":true,"running":true,"diskFreeGb":40}';
    const { runner, calls } = machine("'/reset'", state, state);
    const out = await runSkill(oneDriveSkill(), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out.status).toBe('fixed');
    const script = calls.find((c) => c.includes("'/reset'"))!;
    expect(script).toContain("'/reset'");
    expect(script).toContain('Microsoft\\OneDrive\\OneDrive.exe');
    checkStructure(script);
  });
});

describe('Licence Office (lecture seule)', () => {
  const facts = (products: { name: string; status: string }[], toolFound = true) => parseLicenceFacts(JSON.stringify({ toolFound, products }));

  it('licence active : sain', () => {
    expect(diagnoseLicence(facts([{ name: 'Office 16, Office16O365ProPlusR_Subscription', status: '---LICENSED---' }]))).toMatchObject({ healthy: true, actions: [] });
  });
  it('notifications / sans licence : conseils, technicien, aucune action — l’agent n’active jamais', () => {
    const d = diagnoseLicence(facts([{ name: 'Office 16 ProPlus', status: '---NOTIFICATIONS---' }]));
    expect(d.healthy).toBe(false);
    expect(d.actions).toEqual([]);
    expect(d.needsHuman).toBe(true);
    expect(d.advice.join(' ')).toMatch(/ne contourne jamais/);
  });
  it('période de grâce : signalée', () => {
    expect(diagnoseLicence(facts([{ name: 'Office', status: '---OOB_GRACE---' }])).problems).toEqual(['licence_grace']);
  });
  it('outil introuvable : explique comment lire la licence soi-même', () => {
    const d = diagnoseLicence(facts([], false));
    expect(d.problems).toEqual(['licence_unreadable']);
    expect(d.advice.join(' ')).toMatch(/Fichier > Compte/);
  });
});

describe('routage Microsoft 365', () => {
  const skills = (text: string) => routeIntent(text).filter((i) => i.kind === 'skill').map((i) => (i as { skillId: string }).skillId);
  it('Teams', () => expect(skills('Teams ne se connecte plus')).toEqual(['teams']));
  it('OneDrive', () => expect(skills('ma synchronisation OneDrive est bloquée')).toEqual(['onedrive']));
  it('licence : une seule piste, pas Office en plus', () => expect(skills('Word dit produit non activé')).toEqual(['office-licence']));
  it('Outlook qui plante reste sur la compétence Office', () => expect(skills('Outlook ne répond plus')).toEqual(['office']));
  it('les compétences sont résolues par leur identifiant', () => {
    for (const id of ['teams', 'onedrive', 'office-licence']) expect(resolveSkill(id)?.id).toBe(id);
  });
});
