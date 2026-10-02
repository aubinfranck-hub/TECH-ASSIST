import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { COLLECT_SCRIPT, diagnoseOffice, officeSkill, parseOfficeFacts, type OfficeFacts } from '../skills/office.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const ROOTS = ['C:\\Program Files', 'C:\\Program Files (x86)'];
const OUTLOOK = 'C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE';

const healthy = (): OfficeFacts => ({
  install: { kind: 'c2r', version: '16.0.17126.20132', platform: 'x64', culture: 'fr-fr' },
  outlookPath: OUTLOOK,
  processes: [{ name: 'OUTLOOK', responding: true }],
  crashes: [],
  addins: [],
  dataFiles: [{ name: 'moi@exemple.ci.ost', sizeMb: 2048 }],
  diskFreeGb: 80,
  microsoft365Reachable: true,
  admin: true,
});
const facts = (patch: Partial<OfficeFacts>): OfficeFacts => ({ ...healthy(), ...patch });
const crashes = (app: string, n: number, minutesAgo = 100) => Array.from({ length: n }, (_, i) => ({ app, module: 'mso.dll', minutesAgo: minutesAgo + i }));

describe('diagnoseOffice', () => {
  it('Office sain : rien à faire', () => {
    expect(diagnoseOffice(healthy(), { roots: ROOTS })).toMatchObject({ healthy: true, actions: [], needsHuman: false });
  });

  it('Office absent : passe la main', () => {
    expect(diagnoseOffice(facts({ install: null }), { roots: ROOTS })).toMatchObject({ problems: ['office_missing'], needsHuman: true, actions: [] });
  });

  it('application bloquée : propose de la fermer, une seule fois par application, et prévient de la perte de travail', () => {
    const d = diagnoseOffice(
      facts({ processes: [{ name: 'EXCEL', responding: false }, { name: 'EXCEL', responding: false }, { name: 'OUTLOOK', responding: true }] }),
      { roots: ROOTS },
    );
    expect(d.actions.map((a) => a.id)).toEqual(['close_office_app:EXCEL']);
    expect(d.actions[0]!.explanation).toMatch(/non enregistrées/);
    expect(d.actions[0]!.followUp).toBeTruthy();
  });

  it('un processus qui n’est pas une application Office n’est jamais fermé', () => {
    const d = diagnoseOffice(facts({ processes: [{ name: 'EXPLORER', responding: false }, { name: 'CALC', responding: false }] }), { roots: ROOTS });
    expect(d.actions).toEqual([]);
    expect(d.healthy).toBe(true);
  });

  it('plantages répétés (3 et plus) : réparation rapide, qui demande les droits administrateur', () => {
    expect(diagnoseOffice(facts({ crashes: crashes('WINWORD', 2) }), { roots: ROOTS }).actions).toEqual([]);
    const d = diagnoseOffice(facts({ crashes: crashes('WINWORD', 3) }), { roots: ROOTS });
    expect(d.problems).toEqual(['office_crashing:WINWORD']);
    const repair = d.actions.find((a) => a.id === 'repair_office')!;
    expect(repair.requiresAdmin).toBe(true);
    expect(repair.verified).toBe(false);
    expect(repair.explanation).toMatch(/enregistrez votre travail/);
  });

  it('Office non « Démarrer en un clic » : conseil au lieu de réparation', () => {
    const d = diagnoseOffice(facts({ install: { kind: 'msi', version: '', platform: '', culture: '' }, crashes: crashes('EXCEL', 4) }), { roots: ROOTS });
    expect(d.actions.map((a) => a.id)).not.toContain('repair_office');
    expect(d.advice.join(' ')).toMatch(/Panneau de configuration/);
  });

  it('les plantages antérieurs à une action déjà faite sont ignorés', () => {
    const f = facts({ crashes: crashes('WINWORD', 3, 100) });
    expect(diagnoseOffice(f, { roots: ROOTS, ignoreCrashesOlderThanMinutes: 5 }).healthy).toBe(true);
    expect(diagnoseOffice(f, { roots: ROOTS, ignoreCrashesOlderThanMinutes: 500 }).healthy).toBe(false);
  });

  it('Outlook déjà planté : propose le mode sans échec (chemin contrôlé) et signale les compléments tiers', () => {
    const d = diagnoseOffice(
      facts({
        crashes: crashes('OUTLOOK', 1),
        addins: [
          { name: 'Contoso.Sync', friendly: 'Contoso Sync', loadBehavior: 3 },
          { name: 'UCAddin.LyncAddin', friendly: 'Skype Meeting', loadBehavior: 3 },
          { name: 'Disabled.Thing', friendly: 'Autre', loadBehavior: 2 },
        ],
      }),
      { roots: ROOTS },
    );
    expect(d.actions.map((a) => a.id)).toEqual(['outlook_safe_mode']);
    expect(d.advice.join(' ')).toContain('Contoso Sync');
    expect(d.advice.join(' ')).not.toContain('Skype Meeting');
    expect(d.advice.join(' ')).not.toContain('Autre');
  });

  it('mode sans échec refusé si le chemin d’Outlook n’est pas dans un dossier de programmes', () => {
    for (const outlookPath of ['C:\\Users\\Awa\\AppData\\Local\\Temp\\OUTLOOK.EXE', 'C:\\Windows\\System32\\cmd.exe', '', 'D:\\evil\\OUTLOOK.EXE']) {
      const d = diagnoseOffice(facts({ crashes: crashes('OUTLOOK', 1), outlookPath }), { roots: ROOTS });
      expect(d.actions.map((a) => a.id)).not.toContain('outlook_safe_mode');
    }
  });

  it('Outlook bloqué : on le ferme d’abord, sans proposer en plus le mode sans échec', () => {
    const d = diagnoseOffice(facts({ processes: [{ name: 'OUTLOOK', responding: false }], crashes: crashes('OUTLOOK', 1) }), { roots: ROOTS });
    expect(d.actions.map((a) => a.id)).toEqual(['close_office_app:OUTLOOK']);
  });

  it('fichier de données Outlook énorme : passe la main, l’agent n’y touche pas', () => {
    const d = diagnoseOffice(facts({ dataFiles: [{ name: 'gros.pst', sizeMb: 60 * 1024 }] }), { roots: ROOTS });
    expect(d).toMatchObject({ problems: ['outlook_data_large'], needsHuman: true, actions: [] });
    expect(d.summary).toContain('gros.pst');
  });

  it('disque presque plein et Microsoft 365 injoignable : conseils', () => {
    const d = diagnoseOffice(facts({ diskFreeGb: 0.8, microsoft365Reachable: false }), { roots: ROOTS });
    expect(d.problems).toEqual(['disk_low', 'm365_unreachable']);
    expect(d.actions).toEqual([]);
    expect(d.advice.join(' ')).toMatch(/Internet/);
  });

  it('prévient quand la réparation exigerait un administrateur absent', () => {
    const d = diagnoseOffice(facts({ admin: false, crashes: crashes('EXCEL', 3) }), { roots: ROOTS });
    expect(d.advice.join(' ')).toMatch(/administrateur/);
  });
});

describe('lecture des faits Office', () => {
  it('normalise les noms, tolère champs manquants et objets seuls', () => {
    const parsed = parseOfficeFacts(
      JSON.stringify({
        install: { kind: 'c2r', version: '16.0', platform: 'x64', culture: 'fr-fr' },
        outlookPath: '"C:\\Program Files\\Office\\OUTLOOK.EXE"',
        processes: { name: 'outlook', responding: false },
        crashes: { app: 'excel.exe', module: ' x.dll ', minutesAgo: 5 },
        reachable: true,
      }),
    );
    expect(parsed.outlookPath).toBe('C:\\Program Files\\Office\\OUTLOOK.EXE');
    expect(parsed.processes).toEqual([{ name: 'OUTLOOK', responding: false }]);
    expect(parsed.crashes[0]).toEqual({ app: 'EXCEL.EXE', module: 'x.dll', minutesAgo: 5 });
    expect(parsed.microsoft365Reachable).toBe(true);
    expect(parsed.diskFreeGb).toBeNull();
    expect(() => parseOfficeFacts('rien')).toThrow(/illisible/);
  });
});

describe('compétence Office de bout en bout (faux Windows)', () => {
  function machine(initial: { hung?: boolean; crashCount?: number; platform?: string; culture?: string } = {}) {
    const state = { hung: initial.hung ?? false, crashCount: initial.crashCount ?? 0 };
    const runner = new ScriptedRunner([
      {
        label: 'collect-office',
        test: (s) => s.includes('ClickToRun\\Configuration'),
        reply: () =>
          ok(
            JSON.stringify({
              ...healthy(),
              install: { kind: 'c2r', version: '16', platform: initial.platform ?? 'x64', culture: initial.culture ?? 'fr-fr' },
              processes: [{ name: 'OUTLOOK', responding: !state.hung }],
              crashes: crashes('WINWORD', state.crashCount, 120),
              reachable: true,
            }),
          ),
      },
      { label: 'kill', test: (s) => s.includes('Stop-Process'), reply: () => { state.hung = false; return ok(); } },
      { label: 'repair', test: (s) => s.includes('OfficeClickToRun.exe'), reply: () => ok() },
    ]);
    return { runner, state };
  }

  it('Outlook bloqué : fermeture après accord, vérification, le client confirme, consigne affichée', async () => {
    const { runner } = machine({ hung: true });
    const ui = new ScriptedConversation();
    const out = await runSkill(officeSkill(ROOTS), { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['close_office_app:OUTLOOK'] });
    expect(runner.calls.find((c) => c.label === 'kill')!.script).toContain('Stop-Process -Name OUTLOOK -Force');
    expect(ui.said).toContain('Outlook est fermé');
    expect(ui.questions).toEqual(['Office (ou Outlook) fonctionne-t-il normalement maintenant ?']);
  });

  it('après la réparation, les anciens plantages ne comptent plus : le client est interrogé au lieu de relancer une réparation', async () => {
    const { runner } = machine({ crashCount: 4 });
    const ui = new ScriptedConversation();
    const out = await runSkill(officeSkill(ROOTS), { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['repair_office'] });
    expect(runner.count('repair')).toBe(1);
    expect(ui.said).toContain('fenêtre de réparation');
  });

  it('script de réparation : plateforme et langue assainies, jamais injectées telles quelles', async () => {
    const { runner } = machine({ crashCount: 3, platform: 'x64; calc', culture: "fr-fr' ; calc" });
    await runSkill(officeSkill(ROOTS), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    const script = runner.calls.find((c) => c.label === 'repair')!.script;
    expect(script).toContain('platform=x64 culture=fr-fr');
    expect(script).not.toContain('calc');
    checkStructure(script);
  });

  it('refus du client : aucune modification', async () => {
    const { runner } = machine({ crashCount: 3 });
    const out = await runSkill(officeSkill(ROOTS), { runner, ui: new ScriptedConversation({ approve: { repair_office: false } }), reporter: new Recorder() });
    expect(out.status).toBe('declined');
    expect(runner.count('repair')).toBe(0);
  });
});

describe('script de collecte Office', () => {
  it('est bien formé et ne modifie rien', () => {
    checkStructure(COLLECT_SCRIPT);
    expect(COLLECT_SCRIPT).not.toMatch(/Set-|Start-|Stop-|Remove-|Enable-|Disable-|Clear-|New-Item|Restart-/);
  });
});
