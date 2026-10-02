import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import {
  LIST_SCRIPT,
  defaultRoots,
  findPrograms,
  isAllowedExecutable,
  parsePrograms,
  planUninstall,
  protectedReason,
  uninstallProgramSkill,
  type InstalledProgram,
} from '../skills/uninstall.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const ROOTS = ['C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\Users\\Awa\\AppData\\Local'];
const GUID = '{12345678-ABCD-4321-9876-0123456789AB}';

const program = (patch: Partial<InstalledProgram> = {}): InstalledProgram => ({
  id: 'FooApp',
  scope: 'machine',
  name: 'Foo App',
  publisher: 'Foo Inc',
  version: '1.2.3',
  uninstall: '"C:\\Program Files\\Foo\\unins000.exe"',
  quiet: '',
  msi: false,
  ...patch,
});

describe('findPrograms', () => {
  const list = [
    program({ id: 'a', name: 'TikTok', publisher: 'ByteDance' }),
    program({ id: 'b', name: 'Éditeur PDF Pro', publisher: 'Pdf Co' }),
    program({ id: 'c', name: 'Microsoft Office 365', publisher: 'Microsoft' }),
    program({ id: 'd', name: 'Microsoft Office 365', publisher: 'Microsoft' }), // même logiciel listé deux fois
    program({ id: 'e', name: 'Office Tab', publisher: 'Extra' }),
  ];

  it('ignore accents et casse, et exige tous les mots', () => {
    expect(findPrograms(list, 'editeur pdf').map((p) => p.id)).toEqual(['b']);
    expect(findPrograms(list, 'TIKTOK').map((p) => p.id)).toEqual(['a']);
    expect(findPrograms(list, 'office extra').map((p) => p.id)).toEqual(['e']);
    expect(findPrograms(list, 'photoshop')).toEqual([]);
  });

  it('classe le nom exact avant le reste, dédoublonne et respecte la limite', () => {
    const found = findPrograms(list, 'office');
    expect(found.map((p) => p.name)).toEqual(['Office Tab', 'Microsoft Office 365']); // « commence par » avant « contient », doublon retiré
    expect(findPrograms(list, 'o', 1)).toEqual([]); // un seul caractère : pas de recherche
    expect(findPrograms(list, 'office', 1)).toHaveLength(1);
  });

  it('une requête vide ou sans mot exploitable ne renvoie rien', () => {
    expect(findPrograms(list, '')).toEqual([]);
    expect(findPrograms(list, '  !! ')).toEqual([]);
  });
});

describe('protectedReason', () => {
  it.each([
    ['Windows Defender', 'Microsoft'],
    ['Kaspersky Internet Security', 'AO Kaspersky Lab'],
    ['Malwarebytes version 4', 'Malwarebytes'],
    ['Microsoft Visual C++ 2015-2022 Redistributable (x64)', 'Microsoft'],
    ['Microsoft .NET Runtime 8.0', 'Microsoft'],
    ['Microsoft Edge WebView2 Runtime', 'Microsoft'],
    ['Realtek High Definition Audio Driver', 'Realtek'],
    ['NVIDIA Graphics Driver 551', 'NVIDIA'],
    ['Microsoft Windows Desktop Runtime', 'Microsoft'],
    ['Tech Assist', 'NTIC Strategy'],
    ['TechAssist Agent', ''],
  ])('refuse « %s »', (name, publisher) => {
    expect(protectedReason(program({ name, publisher }))).toBeTruthy();
  });

  it('laisse passer un logiciel ordinaire', () => {
    expect(protectedReason(program({ name: 'TikTok', publisher: 'ByteDance' }))).toBeNull();
    expect(protectedReason(program({ name: 'VLC media player', publisher: 'VideoLAN' }))).toBeNull();
  });
});

describe('isAllowedExecutable', () => {
  it('accepte un .exe sous un dossier de programmes', () => {
    expect(isAllowedExecutable('C:\\Program Files\\Foo\\unins000.exe', ROOTS)).toBe(true);
    expect(isAllowedExecutable('c:\\program files (x86)\\Foo\\Uninstall.EXE', ROOTS)).toBe(true);
  });

  it.each([
    ['C:\\Windows\\System32\\cmd.exe'],
    ['C:\\Program Files\\Foo\\cmd.exe'],
    ['C:\\Program Files\\Foo\\PowerShell.exe'],
    ['C:\\Program Files\\Foo\\msiexec.exe'],
    ['C:\\Program Files\\Foo\\..\\..\\Windows\\System32\\calc.exe'],
    ['C:\\Program Files Evil\\x.exe'], // préfixe trompeur
    ['C:\\Users\\Awa\\AppData\\Local\\Temp\\setup.exe'],
    ['\\\\serveur\\partage\\x.exe'],
    ['C:\\Program Files\\Foo\\script.bat'],
    ['unins000.exe'],
  ])('refuse %s', (exe) => {
    expect(isAllowedExecutable(exe, ROOTS)).toBe(false);
  });
});

describe('planUninstall', () => {
  it('refuse les logiciels protégés avant toute autre analyse', () => {
    const plan = planUninstall(program({ name: 'Kaspersky', publisher: 'Kaspersky' }), ROOTS);
    expect(plan.ok).toBe(false);
  });

  it('MSI : la commande est reconstruite par l’agent à partir du seul GUID', () => {
    const plan = planUninstall(program({ uninstall: `MsiExec.exe /I${GUID}`, msi: true }), ROOTS);
    expect(plan).toMatchObject({ ok: true, kind: 'msi', exe: 'msiexec.exe', args: `/x ${GUID} /passive /norestart` });
  });

  it('MSI : ce qui suit le GUID dans la commande du registre est jeté', () => {
    const plan = planUninstall(program({ uninstall: `MsiExec.exe /X${GUID} & calc.exe` }), ROOTS);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.shown).not.toMatch(/calc|&/);
      expect(plan.args).toBe(`/x ${GUID} /passive /norestart`);
    }
  });

  it('MSI repéré par l’indicateur Windows Installer et le nom de clé', () => {
    const plan = planUninstall(program({ id: GUID, msi: true, uninstall: 'peu importe' }), ROOTS);
    expect(plan).toMatchObject({ ok: true, kind: 'msi' });
  });

  it('MSI : une clé qui n’est pas un vrai GUID n’est pas utilisée', () => {
    expect(planUninstall(program({ id: '{pas-un-guid}', msi: true, uninstall: 'msiexec /x {pas-un-guid}' }), ROOTS).ok).toBe(false);
  });

  it('exécutable propre au logiciel : accepté sous Program Files, avec ses arguments', () => {
    const plan = planUninstall(program({ uninstall: '"C:\\Program Files\\Foo\\unins000.exe" /SILENT' }), ROOTS);
    expect(plan).toMatchObject({ ok: true, kind: 'exe', exe: 'C:\\Program Files\\Foo\\unins000.exe', args: '/SILENT' });
    if (plan.ok) expect(plan.shown).toBe('"C:\\Program Files\\Foo\\unins000.exe" /SILENT');
  });

  it('chemin sans guillemets et avec espaces', () => {
    const plan = planUninstall(program({ uninstall: 'C:\\Program Files\\Foo Bar\\uninstall.exe /S' }), ROOTS);
    expect(plan).toMatchObject({ ok: true, exe: 'C:\\Program Files\\Foo Bar\\uninstall.exe', args: '/S' });
  });

  it('préfère la commande silencieuse quand elle est sûre, sinon retombe sur l’autre', () => {
    const quiet = planUninstall(program({ quiet: '"C:\\Program Files\\Foo\\unins000.exe" /VERYSILENT', uninstall: '"C:\\Program Files\\Foo\\unins000.exe"' }), ROOTS);
    expect(quiet).toMatchObject({ ok: true, args: '/VERYSILENT' });
    const fallback = planUninstall(program({ quiet: 'cmd.exe /c del x', uninstall: '"C:\\Program Files\\Foo\\unins000.exe"' }), ROOTS);
    expect(fallback).toMatchObject({ ok: true, args: '' });
  });

  it.each([
    ['cmd.exe /c rd /s /q C:\\'],
    ['"C:\\Program Files\\Foo\\unins000.exe" /S & del C:\\x'],
    ['"C:\\Program Files\\Foo\\unins000.exe" /S | calc'],
    ['"C:\\Program Files\\Foo\\unins000.exe" /S; calc'],
    ['"C:\\Program Files\\Foo\\unins000.exe" /S > out.txt'],
    ['"C:\\Program Files\\Foo\\unins000.exe" /S `calc`'],
    ['"C:\\Users\\Awa\\AppData\\Local\\Temp\\evil.exe"'],
    ['powershell -enc AAAA'],
    ['"C:\\Program Files\\Foo\\unins000.exe /S'], // guillemet jamais refermé
    [''],
  ])('refuse la commande douteuse : %s', (uninstall) => {
    const plan = planUninstall(program({ uninstall }), ROOTS);
    expect(plan.ok).toBe(false);
  });

  it('refuse un chemin contenant une apostrophe typographique, mais double l’apostrophe droite', () => {
    expect(planUninstall(program({ uninstall: '"C:\\Program Files\\O’Brien\\unins.exe"' }), ROOTS).ok).toBe(false);
    expect(planUninstall(program({ uninstall: '"C:\\Program Files\\O\'Brien\\unins.exe"' }), ROOTS).ok).toBe(true);
  });

  it('defaultRoots ne garde que des chemins de disque, sans doublon', () => {
    const roots = defaultRoots({ ProgramFiles: 'C:\\Program Files\\', LOCALAPPDATA: '\\\\srv\\x', APPDATA: 'C:\\Users\\A\\AppData\\Roaming', ProgramW6432: 'C:\\Program Files' });
    expect(roots).toContain('C:\\Program Files');
    expect(roots).not.toContain('\\\\srv\\x');
    expect(roots.filter((r) => r === 'C:\\Program Files')).toHaveLength(1);
  });
});

describe('parsePrograms', () => {
  it('tolère un objet seul, des champs manquants et ignore les entrées sans nom ou sans clé', () => {
    const raw = JSON.stringify({ programs: { id: 'x', name: ' VLC ', msi: true }, admin: false });
    const parsed = parsePrograms(raw);
    expect(parsed.programs).toEqual([{ id: 'x', scope: 'machine', name: 'VLC', publisher: '', version: '', uninstall: '', quiet: '', msi: true }]);
    expect(parsed.admin).toBe(false);
    expect(parsePrograms(JSON.stringify({ programs: [{ id: '', name: 'A' }, { id: 'b', name: '' }] })).programs).toEqual([]);
  });
});

describe('compétence de désinstallation de bout en bout (faux Windows)', () => {
  const tiktok = program({ id: 'TikTok', name: 'TikTok', publisher: 'ByteDance', uninstall: '"C:\\Program Files\\TikTok\\uninst.exe"' });

  function machine(opts: { removes?: boolean; programs?: InstalledProgram[] } = {}) {
    const state = { programs: opts.programs ?? [tiktok] };
    const runner = new ScriptedRunner([
      { label: 'collect-programs', test: (s) => s.includes('CurrentVersion\\Uninstall'), reply: () => ok(JSON.stringify({ programs: state.programs, admin: true })) },
      {
        label: 'uninstall',
        test: (s) => s.includes('Start-Process -FilePath'),
        reply: () => {
          if (opts.removes !== false) state.programs = state.programs.filter((p) => p.id !== 'TikTok');
          return ok('Terminé (code 0)');
        },
      },
    ]);
    return { runner, state };
  }

  it('montre la commande exacte, désinstalle après accord, vérifie, le client confirme', async () => {
    const { runner } = machine();
    const ui = new ScriptedConversation();
    const out = await runSkill(uninstallProgramSkill(tiktok, ROOTS), { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['uninstall_program'] });
    expect(ui.questions).toEqual(['« TikTok » a-t-il bien disparu de votre ordinateur ?']);
    const call = runner.calls.find((c) => c.label === 'uninstall')!;
    expect(call.script).toContain("-FilePath 'C:\\Program Files\\TikTok\\uninst.exe'");
    checkStructure(call.script);
  });

  it('le client voit la commande exacte avant de répondre', async () => {
    const { runner } = machine();
    let explanation = '';
    const ui = new ScriptedConversation();
    const original = ui.confirmAction.bind(ui);
    ui.confirmAction = async (action) => {
      explanation = action.explanation;
      return original(action);
    };
    await runSkill(uninstallProgramSkill(tiktok, ROOTS), { runner, ui, reporter: new Recorder() });
    expect(explanation).toContain('Commande exacte : "C:\\Program Files\\TikTok\\uninst.exe"');
  });

  it('refus du client : rien n’est lancé', async () => {
    const { runner } = machine();
    const ui = new ScriptedConversation({ approve: { uninstall_program: false } });
    const out = await runSkill(uninstallProgramSkill(tiktok, ROOTS), { runner, ui, reporter: new Recorder() });
    expect(out.status).toBe('declined');
    expect(runner.count('uninstall')).toBe(0);
  });

  it('logiciel déjà absent : rien à faire, le client confirme', async () => {
    const { runner } = machine({ programs: [] });
    const ui = new ScriptedConversation();
    const out = await runSkill(uninstallProgramSkill(tiktok, ROOTS), { runner, ui, reporter: new Recorder() });
    expect(out.status).toBe('fixed');
    expect(runner.count('uninstall')).toBe(0);
  });

  it('logiciel protégé ou commande douteuse : passe la main sans rien exécuter', async () => {
    const av = program({ id: 'KAV', name: 'Kaspersky', publisher: 'Kaspersky' });
    const { runner } = machine({ programs: [av] });
    const out = await runSkill(uninstallProgramSkill(av, ROOTS), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out.status).toBe('escalated');
    expect(runner.count('uninstall')).toBe(0);

    const shady = program({ id: 'Shady', name: 'Shady', uninstall: 'cmd.exe /c calc' });
    const second = machine({ programs: [shady] });
    const out2 = await runSkill(uninstallProgramSkill(shady, ROOTS), { runner: second.runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out2.status).toBe('escalated');
    expect(second.runner.count('uninstall')).toBe(0);
  });

  it('le désinstallateur tourne mais le logiciel reste : passe la main, sans relancer', async () => {
    const { runner } = machine({ removes: false });
    const ui = new ScriptedConversation();
    const out = await runSkill(uninstallProgramSkill(tiktok, ROOTS), { runner, ui, reporter: new Recorder() });
    expect(out.status).toBe('escalated');
    expect(runner.count('uninstall')).toBe(1);
  });

  it('MSI : le script vérifie le code de sortie', async () => {
    const msi = program({ id: GUID, name: 'Vieux logiciel', msi: true, uninstall: `MsiExec.exe /I${GUID}` });
    const state = { present: true };
    const runner = new ScriptedRunner([
      { label: 'collect-programs', test: (s) => s.includes('CurrentVersion\\Uninstall'), reply: () => ok(JSON.stringify({ programs: state.present ? [msi] : [], admin: true })) },
      { label: 'uninstall', test: (s) => s.includes('Start-Process -FilePath'), reply: () => { state.present = false; return ok(); } },
    ]);
    await runSkill(uninstallProgramSkill(msi, ROOTS), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    const script = runner.calls.find((c) => c.label === 'uninstall')!.script;
    expect(script).toContain(`-FilePath (Join-Path $env:windir 'System32\\msiexec.exe') -ArgumentList '/x ${GUID} /passive /norestart'`);
    expect(script).toContain('3010');
    checkStructure(script);
  });
});

describe('script de liste des logiciels', () => {
  it('est bien formé et ne modifie rien', () => {
    checkStructure(LIST_SCRIPT);
    expect(LIST_SCRIPT).not.toMatch(/Set-|Start-|Stop-|Remove-|Enable-|Disable-|Clear-|New-Item|Restart-/);
  });
});
