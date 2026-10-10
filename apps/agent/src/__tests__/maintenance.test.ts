import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { batteryWear, COLLECT_SCRIPT as BATTERY_SCRIPT, diagnoseBattery, parseBatteryFacts } from '../skills/battery.js';
import { COLLECT_SCRIPT as CLEANUP_SCRIPT, cleanupSkill, diagnoseCleanup, parseCleanupFacts, type CleanupFacts } from '../skills/cleanup.js';
import { COLLECT_SCRIPT as CRASH_SCRIPT, crashesSkill, diagnoseCrashes, parseCrashFacts } from '../skills/crashes.js';
import { COLLECT_SCRIPT as DISK_SCRIPT, diagnoseDisk, diskSkill, parseDiskFacts, type DiskFacts } from '../skills/disk.js';
import { COLLECT_SCRIPT as DRIVER_SCRIPT, DEVICE_ID, diagnoseDrivers, driversSkill, parseDriverFacts, type DriverFacts } from '../skills/drivers.js';
import { COLLECT_SCRIPT as PERF_SCRIPT, diagnosePerformance, parsePerformanceFacts, type PerformanceFacts } from '../skills/performance.js';
import { COLLECT_SCRIPT as SECURITY_SCRIPT, diagnoseSecurity, parseSecurityFacts, type SecurityFacts } from '../skills/security.js';
import { COLLECT_SCRIPT as STARTUP_SCRIPT, diagnoseStartup, parseStartupFacts, startupSkill } from '../skills/startup.js';
import { COLLECT_SCRIPT as WINREPAIR_SCRIPT, diagnoseWindowsRepair, parseWindowsRepairFacts, windowsRepairSkill } from '../skills/windowsRepair.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const MODIFYING = /Set-|Start-|Stop-|Remove-|Enable-|Disable-|Clear-|New-Item|Restart-|Update-|Checkpoint-|Repair-Volume/;

describe('scripts de collecte : bien formés et en lecture seule', () => {
  const scripts: Record<string, string> = { cleanup: CLEANUP_SCRIPT, disk: DISK_SCRIPT, drivers: DRIVER_SCRIPT, startup: STARTUP_SCRIPT, performance: PERF_SCRIPT, battery: BATTERY_SCRIPT, crashes: CRASH_SCRIPT, security: SECURITY_SCRIPT };
  for (const [name, script] of Object.entries(scripts)) {
    it(name, () => {
      checkStructure(script);
      expect(script).not.toMatch(MODIFYING);
    });
  }

  it('windowsRepair : la seule cmdlet « Repair » est -CheckHealth, sans -RestoreHealth', () => {
    checkStructure(WINREPAIR_SCRIPT);
    const cmdlets = WINREPAIR_SCRIPT.match(/\b[A-Z][a-z]+-[A-Za-z]+\b/g)!.filter((c) => !['Get-Item'].includes(c));
    const modifying = cmdlets.filter((c) => /^(Set|Start|Stop|Remove|Enable|Disable|Clear|New|Restart|Update|Checkpoint|Repair)-/.test(c));
    expect([...new Set(modifying)]).toEqual(['Repair-WindowsImage']);
    expect(WINREPAIR_SCRIPT).toContain('-CheckHealth');
    expect(WINREPAIR_SCRIPT).not.toContain('-RestoreHealth');
  });
});

const cleanFacts = (p: Partial<CleanupFacts> = {}): CleanupFacts => ({ tempBytes: 0, windowsTempBytes: 0, browserCacheBytes: 0, recycleBytes: 0, freeBytes: 200 * GB, totalBytes: 500 * GB, admin: true, ...p });

describe('nettoyage', () => {
  it('rien à nettoyer', () => {
    expect(diagnoseCleanup(cleanFacts())).toMatchObject({ healthy: true, actions: [] });
  });

  it('propose chaque nettoyage utile, sans chiffre dans id ni titre', () => {
    const d = diagnoseCleanup(cleanFacts({ tempBytes: 2 * GB, browserCacheBytes: 500 * MB, recycleBytes: 400 * MB }));
    expect(d.actions.map((a) => a.id)).toEqual(['clean_temp', 'clear_browser_cache', 'empty_recycle_bin']);
    for (const a of d.actions) expect(a.id + a.title).not.toMatch(/\d/);
    expect(d.healthy).toBe(false);
  });

  it('en dessous du seuil : on ne dérange pas', () => {
    expect(diagnoseCleanup(cleanFacts({ tempBytes: 150 * MB })).actions).toEqual([]);
  });

  it('la corbeille est présentée comme irréversible', () => {
    const a = diagnoseCleanup(cleanFacts({ recycleBytes: 1 * GB, tempBytes: 1 * GB })).actions.find((x) => x.id === 'empty_recycle_bin')!;
    expect(a.explanation).toMatch(/PLUS être récupérés/);
  });

  it('disque presque plein et déjà nettoyé : nettoyage des composants Windows en dernier recours', () => {
    const f = cleanFacts({ freeBytes: 20 * GB, totalBytes: 500 * GB, tempBytes: 1 * GB });
    expect(diagnoseCleanup(f).actions.map((a) => a.id)).not.toContain('component_cleanup');
    expect(diagnoseCleanup(f, new Set(['clean_temp'])).actions.map((a) => a.id)).toContain('component_cleanup');
  });

  it('disque plein sans rien à nettoyer : conseil', () => {
    const d = diagnoseCleanup(cleanFacts({ freeBytes: 40 * GB, totalBytes: 500 * GB }));
    expect(d.actions).toEqual([]);
    expect(d.advice.join(' ')).toMatch(/Téléchargements/);
  });

  it('parse tolérant : BOM, texte parasite, valeurs invalides', () => {
    const f = parseCleanupFacts('﻿bruit {"tempBytes": -5, "recycleBytes": "x", "browserCacheBytes": 10, "admin": true} fin');
    expect(f).toMatchObject({ tempBytes: 0, recycleBytes: 0, browserCacheBytes: 10, freeBytes: null, admin: true });
    expect(() => parseCleanupFacts('pas de json')).toThrow(/illisible/);
  });

  it('les scripts de nettoyage ne touchent que les dossiers prévus', async () => {
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    const d = diagnoseCleanup(cleanFacts({ tempBytes: 1 * GB, browserCacheBytes: 1 * GB, recycleBytes: 1 * GB }));
    for (const a of d.actions) await a.run(runner);
    for (const c of runner.calls) {
      checkStructure(c.script);
      expect(c.script).not.toMatch(/Documents|Desktop|Bureau|\.pst|\.ost|Cookies|Login Data|History/i);
    }
    const temp = runner.calls[0]!.script;
    expect(temp).toContain('AddDays(-1)');
  });

  it('suppression prudente : refuse racine de disque, profil et dossier Windows ; ignore tout ce qui passe par un lien', async () => {
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    for (const a of diagnoseCleanup(cleanFacts({ tempBytes: 1 * GB, browserCacheBytes: 1 * GB })).actions) await a.run(runner);
    expect(runner.calls).toHaveLength(2);
    for (const c of runner.calls) {
      expect(c.script).toContain('Remove-FilesSafely');
      expect(c.script).toContain('ReparsePoint');
      expect(c.script).toContain('$env:USERPROFILE');
      expect(c.script).toContain("'^[A-Za-z]:$'");
      // un seul endroit supprime, et c'est la fonction prudente
      expect(c.script.match(/Remove-Item/g)).toHaveLength(1);
    }
  });

  it('de bout en bout : accord, nettoyage, relecture, confirmation', async () => {
    const state = { cleaned: false };
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('ConvertTo-Json'), reply: () => ok(JSON.stringify(cleanFacts({ tempBytes: state.cleaned ? 0 : 2 * GB }))) },
      { label: 'clean', test: (s) => s.includes('Remove-Item'), reply: () => { state.cleaned = true; return ok(); } },
    ]);
    const ui = new ScriptedConversation();
    const out = await runSkill(cleanupSkill(), { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['clean_temp'] });
  });

  it('refus : rien n’est exécuté', async () => {
    const runner = new ScriptedRunner([{ label: 'collect', test: (s) => s.includes('Get-FolderSize'), reply: () => ok(JSON.stringify(cleanFacts({ tempBytes: 2 * GB }))) }]);
    const out = await runSkill(cleanupSkill(), { runner, ui: new ScriptedConversation({ approve: { clean_temp: false } }), reporter: new Recorder() });
    expect(out.status).toBe('declined');
    expect(runner.modifications.filter((c) => c.label !== 'collect')).toEqual([]);
  });
});

const diskFacts = (p: Partial<DiskFacts> = {}): DiskFacts => ({
  volumes: [{ letter: 'C', sizeBytes: 500 * GB, freeBytes: 200 * GB, health: 'Healthy', system: true }],
  disks: [{ name: 'Samsung SSD', health: 'Healthy', media: 'SSD', predictFailure: false }],
  admin: true,
  ...p,
});

describe('disque', () => {
  it('sain', () => {
    expect(diagnoseDisk(diskFacts())).toMatchObject({ healthy: true, needsHuman: false, actions: [] });
  });

  it('disque défaillant : prévient, ne propose AUCUNE réparation, passe la main', () => {
    const d = diagnoseDisk(diskFacts({ disks: [{ name: 'WD', health: 'Warning', media: 'HDD', predictFailure: true }], volumes: [{ letter: 'C', sizeBytes: 500 * GB, freeBytes: 200 * GB, health: 'Unhealthy', system: true }] }));
    expect(d.needsHuman).toBe(true);
    expect(d.actions).toEqual([]);
    expect(d.advice.join(' ')).toMatch(/Sauvegardez/);
  });

  it('SMART seul (disque « Healthy » mais panne annoncée) : même traitement', () => {
    const d = diagnoseDisk(diskFacts({ disks: [{ name: 'WD', health: 'Healthy', media: 'HDD', predictFailure: true }] }));
    expect(d.needsHuman).toBe(true);
  });

  it('erreurs de système de fichiers : analyse du volume ; redémarrage possible sur le lecteur Windows', () => {
    const d = diagnoseDisk(diskFacts({ volumes: [{ letter: 'C', sizeBytes: 500 * GB, freeBytes: 200 * GB, health: 'Unhealthy', system: true }] }));
    expect(d.actions.map((a) => a.id)).toEqual(['repair_volume']);
    expect(d.actions[0]!.needsReboot).toBe(true);
    expect(d.actions[0]!.verified).toBe(false);
  });

  it('une réparation déjà tentée qui n’a pas suffi : passe la main', () => {
    const d = diagnoseDisk(diskFacts({ volumes: [{ letter: 'C', sizeBytes: 500 * GB, freeBytes: 200 * GB, health: 'Unhealthy', system: true }] }), new Set(['repair_volume']));
    expect(d).toMatchObject({ needsHuman: true, actions: [] });
  });

  it('lettre de lecteur douteuse : jamais dans un script', () => {
    const d = diagnoseDisk(diskFacts({ volumes: [{ letter: "C'; calc", sizeBytes: 1, freeBytes: 1, health: 'Unhealthy', system: false }] }));
    expect(d.actions).toEqual([]);
  });

  it('presque plein : conseil (🟡), pas de panique', () => {
    const d = diagnoseDisk(diskFacts({ volumes: [{ letter: 'C', sizeBytes: 500 * GB, freeBytes: 20 * GB, health: 'Healthy', system: true }] }));
    expect(d.healthy).toBe(true);
    expect(d.advice.join(' ')).toMatch(/presque plein/);
  });

  it('parse tolérant : un seul volume, pas de disque', () => {
    const f = parseDiskFacts('{"volumes":{"letter":"c","sizeBytes":10,"freeBytes":5,"health":"Healthy","system":true},"admin":false}');
    expect(f.volumes[0]).toMatchObject({ letter: 'C', system: true });
    expect(f.disks).toEqual([]);
  });

  it('le script de réparation est bien formé', async () => {
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    const a = diagnoseDisk(diskFacts({ volumes: [{ letter: 'D', sizeBytes: 1, freeBytes: 1, health: 'Unhealthy', system: false }] })).actions[0]!;
    await a.run(runner);
    checkStructure(runner.calls[0]!.script);
    expect(runner.calls[0]!.script).toContain('-DriveLetter D');
  });

  it('de bout en bout avec un disque qui s’abîme : aucune modification, passage de main enregistré', async () => {
    const runner = new ScriptedRunner([{ label: 'collect', test: (s) => s.includes('Get-PhysicalDisk'), reply: () => ok(JSON.stringify(diskFacts({ disks: [{ name: 'WD', health: 'Warning', media: 'HDD', predictFailure: true }] }))) }]);
    const reporter = new Recorder();
    const out = await runSkill(diskSkill(), { runner, ui: new ScriptedConversation(), reporter });
    expect(out.status).toBe('escalated');
    expect(runner.calls.every((c) => c.label === 'collect')).toBe(true);
    expect(reporter.types).toContain('escalated');
  });
});

describe('réparation de Windows (DISM / SFC)', () => {
  it('image saine, pas de demande : rien à faire', () => {
    expect(diagnoseWindowsRepair({ imageState: 'Healthy', admin: true })).toMatchObject({ healthy: true, actions: [] });
  });

  it('image saine, SFC demandé : SFC seul', () => {
    expect(diagnoseWindowsRepair({ imageState: 'Healthy', admin: true }, { runSfc: true }).actions.map((a) => a.id)).toEqual(['sfc_scan']);
  });

  it('image réparable : DISM (sensible, point de restauration) puis SFC', () => {
    const d = diagnoseWindowsRepair({ imageState: 'Repairable', admin: true });
    expect(d.actions.map((a) => a.id)).toEqual(['dism_restore_health', 'sfc_scan']);
    expect(d.actions[0]!.risk).toBe('sensitive');
  });

  it('non réparable : technicien', () => {
    expect(diagnoseWindowsRepair({ imageState: 'NonRepairable', admin: true })).toMatchObject({ needsHuman: true, actions: [] });
  });

  it('état illisible sans droits : conseil, pas de faux « sain »', () => {
    const d = diagnoseWindowsRepair({ imageState: 'Unknown', admin: false });
    expect(d.advice.join(' ')).toMatch(/administrateur/);
    expect(d.summary).toMatch(/n'a pas pu être lu/);
  });

  it('réparation faite mais image toujours abîmée : technicien', () => {
    expect(diagnoseWindowsRepair({ imageState: 'Repairable', admin: true }, {}, new Set(['dism_restore_health', 'sfc_scan']))).toMatchObject({ needsHuman: true });
  });

  it('parse : valeur inconnue → Unknown', () => {
    expect(parseWindowsRepairFacts('{"imageState":"Banane","admin":true}').imageState).toBe('Unknown');
    expect(parseWindowsRepairFacts('{"imageState":"Repairable"}').imageState).toBe('Repairable');
  });

  it('de bout en bout : point de restauration, DISM, SFC, relecture saine', async () => {
    const state = { fixed: false };
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('-CheckHealth'), reply: () => ok(JSON.stringify({ imageState: state.fixed ? 'Healthy' : 'Repairable', admin: true })) },
      { label: 'restore', test: (s) => s.includes('Checkpoint-Computer'), reply: () => ok() },
      { label: 'dism', test: (s) => s.includes('-RestoreHealth'), reply: () => { state.fixed = true; return ok(); } },
      { label: 'sfc', test: (s) => s.includes('sfc.exe'), reply: () => ok() },
    ]);
    const ui = new ScriptedConversation();
    const out = await runSkill(windowsRepairSkill(), { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['dism_restore_health', 'sfc_scan'] });
    expect(runner.calls.map((c) => c.label).filter((l) => l !== 'collect')).toEqual(['restore', 'dism', 'sfc']);
    for (const c of runner.calls) checkStructure(c.script);
  });
});

const driverFacts = (p: Partial<DriverFacts> = {}): DriverFacts => ({ problems: [], oldDrivers: [], admin: true, ...p });
const dev = (code: number, id = 'USB\\VID_046D&PID_0825\\5&2A7B&0&2', name = 'Webcam') => ({ name, deviceClass: 'Camera', id, code });

describe('pilotes', () => {
  it('aucun appareil en erreur', () => {
    expect(diagnoseDrivers(driverFacts())).toMatchObject({ healthy: true, actions: [] });
  });

  it('appareil désactivé : le réactiver', () => {
    expect(diagnoseDrivers(driverFacts({ problems: [dev(22)] })).actions.map((a) => a.id)).toEqual(['enable_device']);
  });

  it('pilote absent : recherche d’appareils, puis Windows Update, puis technicien', () => {
    const f = driverFacts({ problems: [dev(28)] });
    expect(diagnoseDrivers(f).actions.map((a) => a.id)).toEqual(['rescan_devices']);
    expect(diagnoseDrivers(f, new Set(['rescan_devices'])).actions.map((a) => a.id)).toEqual(['open_windows_update']);
    expect(diagnoseDrivers(f, new Set(['rescan_devices', 'open_windows_update']))).toMatchObject({ needsHuman: true, actions: [] });
  });

  it('erreur de démarrage : redémarrer l’appareil, avec point de restauration', () => {
    const a = diagnoseDrivers(driverFacts({ problems: [dev(43)] })).actions[0]!;
    expect(a.id).toBe('restart_device');
    expect(a.risk).toBe('sensitive');
  });

  it('identifiant douteux : jamais dans un script', () => {
    const d = diagnoseDrivers(driverFacts({ problems: [dev(22, "USB\\x'; calc ; '")] }));
    expect(d.actions).toEqual([]);
    expect(DEVICE_ID.test("USB\\x'; calc")).toBe(false);
    expect(DEVICE_ID.test('PCI\\VEN_8086&DEV_1234\\3&11583659&0&FA')).toBe(true);
    expect(DEVICE_ID.test('{4d36e96c-e325-11ce-bfc1-08002be10318}')).toBe(true);
  });

  it('anciens pilotes : conseil seulement', () => {
    const d = diagnoseDrivers(driverFacts({ oldDrivers: ['Intel Wi-Fi'] }));
    expect(d.healthy).toBe(true);
    expect(d.advice.join(' ')).toMatch(/Intel Wi-Fi/);
  });

  it('parse : nom piégé nettoyé, code 0 ignoré', () => {
    const f = parseDriverFacts(JSON.stringify({ problems: [{ name: 'Cam\néra\u0000', deviceClass: 'Camera', id: 'USB\\A', code: 22 }, { name: 'OK', id: 'X', code: 0 }], oldDrivers: 'Pilote', admin: true }));
    expect(f.problems).toHaveLength(1);
    expect(f.problems[0]!.name).toBe('Cam éra');
    expect(f.oldDrivers).toEqual(['Pilote']);
  });

  it('scripts d’action bien formés', async () => {
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    for (const a of [...diagnoseDrivers(driverFacts({ problems: [dev(22)] })).actions, ...diagnoseDrivers(driverFacts({ problems: [dev(43)] })).actions, ...diagnoseDrivers(driverFacts({ problems: [dev(28)] })).actions]) {
      await a.run(runner);
    }
    for (const c of runner.calls) checkStructure(c.script);
    expect(runner.calls.some((c) => c.script.includes('Enable-PnpDevice'))).toBe(true);
  });

  it('de bout en bout : appareil désactivé → réactivé → confirmé', async () => {
    const state = { on: false };
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('Win32_PnPEntity'), reply: () => ok(JSON.stringify(driverFacts({ problems: state.on ? [] : [dev(22)] }))) },
      { label: 'enable', test: (s) => s.includes('Enable-PnpDevice'), reply: () => { state.on = true; return ok(); } },
    ]);
    const out = await runSkill(driversSkill(), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['enable_device'] });
  });
});

describe('démarrage', () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `App${i}`, location: 'HKLM' }));
  it('peu de programmes : raisonnable', () => {
    expect(diagnoseStartup({ items: items(5), admin: true })).toMatchObject({ healthy: true, actions: [] });
  });
  it('beaucoup : ouvre la page des Paramètres, n’écrit rien dans le registre', async () => {
    const d = diagnoseStartup({ items: items(15), admin: true });
    expect(d.actions.map((a) => a.id)).toEqual(['open_startup_settings']);
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    await d.actions[0]!.run(runner);
    expect(runner.calls[0]!.script).toContain('ms-settings:startupapps');
    expect(runner.calls[0]!.script).not.toMatch(/Registry|HKLM|HKCU|Set-ItemProperty/);
    checkStructure(runner.calls[0]!.script);
  });
  it('une fois la page ouverte : sain', () => {
    expect(diagnoseStartup({ items: items(15), admin: true }, true).healthy).toBe(true);
  });
  it('parse tolérant', () => {
    expect(parseStartupFacts('{"items":{"name":"OneDrive","location":"HKCU"}}').items).toHaveLength(1);
  });
  it('de bout en bout', async () => {
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('Win32_StartupCommand'), reply: () => ok(JSON.stringify({ items: items(15), admin: true })) },
      { label: 'open', test: (s) => s.includes('ms-settings'), reply: () => ok() },
    ]);
    const ui = new ScriptedConversation();
    const out = await runSkill(startupSkill(), { runner, ui, reporter: new Recorder() });
    expect(out.status).toBe('fixed');
    expect(ui.said).toMatch(/désactivez les programmes inutiles/);
  });
});

const perf = (p: Partial<PerformanceFacts> = {}): PerformanceFacts => ({ totalRamBytes: 8 * GB, freeRamBytes: 4 * GB, cpuPercent: 20, uptimeDays: 1, top: [{ name: 'chrome', ramBytes: 2 * GB }], ...p });

describe('performances', () => {
  it('normales', () => {
    expect(diagnosePerformance(perf())).toMatchObject({ healthy: true, problems: [] });
  });
  it('mémoire saturée et longue durée : redémarrage recommandé (needsReboot), programmes gourmands cités', () => {
    const d = diagnosePerformance(perf({ freeRamBytes: 0.4 * GB, uptimeDays: 20 }));
    expect(d.problems).toEqual(['ram_high', 'long_uptime']);
    expect(d.actions.map((a) => a.id)).toEqual(['restart_recommended']);
    expect(d.actions[0]!.needsReboot).toBe(true);
    expect(d.advice.join(' ')).toMatch(/chrome/);
  });
  it('mémoire saturée mais PC récent : conseil seulement, pas d’action ni de faux problème bloquant', () => {
    const d = diagnosePerformance(perf({ freeRamBytes: 0.4 * GB, uptimeDays: 0.5 }));
    expect(d.actions).toEqual([]);
    expect(d.healthy).toBe(true);
  });
  it('4 Go de mémoire : conseil d’ajouter de la mémoire', () => {
    expect(diagnosePerformance(perf({ totalRamBytes: 4 * GB, freeRamBytes: 0.2 * GB })).advice.join(' ')).toMatch(/ajouter de la mémoire/);
  });
  it('processeur saturé', () => {
    expect(diagnosePerformance(perf({ cpuPercent: 99 })).problems).toEqual(['cpu_high']);
  });
  it('le nom d’un processus n’est jamais exécutable (nettoyé)', () => {
    expect(parsePerformanceFacts(JSON.stringify({ top: [{ name: "a'\n;calc", ramBytes: 5 }] })).top[0]!.name).not.toMatch(/\n/);
  });
  it('titre de l’action stable (aucun chiffre)', () => {
    const a = diagnosePerformance(perf({ uptimeDays: 20 })).actions[0]!;
    expect(a.id + a.title).not.toMatch(/\d/);
  });
});

describe('batterie', () => {
  it('pas de batterie', () => {
    expect(diagnoseBattery({ present: false, chargePercent: null, designMwh: null, fullMwh: null }).summary).toMatch(/Pas de batterie/);
  });
  it('usure calculée et conseil au-delà de 50 %', () => {
    const f = { present: true, chargePercent: 80, designMwh: 50000, fullMwh: 20000 };
    expect(batteryWear(f)).toBeCloseTo(0.6);
    expect(diagnoseBattery(f).advice.join(' ')).toMatch(/remplacer/);
  });
  it('usure inconnue : on ne l’invente pas', () => {
    const d = diagnoseBattery({ present: true, chargePercent: 80, designMwh: null, fullMwh: null });
    expect(d.summary).toMatch(/pas pu être mesurée/);
  });
  it('jamais d’action ni de problème : informatif', () => {
    expect(diagnoseBattery({ present: true, chargePercent: 10, designMwh: 100, fullMwh: 10 })).toMatchObject({ healthy: true, actions: [], needsHuman: false });
  });
  it('parse', () => {
    expect(parseBatteryFacts('{"present":true,"chargePercent":55,"designMwh":1,"fullMwh":"x"}')).toMatchObject({ present: true, chargePercent: 55, fullMwh: null });
  });
});

describe('plantages', () => {
  const f = (k: number, b = 0, u = 0) => ({ kernelPower: k, bugchecks: b, unexpectedShutdowns: u, dumpFiles: 0 });
  it('aucun', () => expect(diagnoseCrashes(f(0)).healthy).toBe(true));
  it('un seul : rien d’inquiétant', () => expect(diagnoseCrashes(f(1)).healthy).toBe(true));
  it('quelques-uns : Windows Update, conseils', () => {
    const d = diagnoseCrashes(f(3, 2));
    expect(d.actions.map((a) => a.id)).toEqual(['open_windows_update']);
    expect(d.summary).toMatch(/2 écran\(s\) bleu\(s\)/);
  });
  it('5 ou plus : matériel probable, technicien, aucune action', () => {
    expect(diagnoseCrashes(f(5))).toMatchObject({ needsHuman: true, actions: [] });
  });
  it('mises à jour déjà vérifiées : on s’arrête', () => {
    expect(diagnoseCrashes(f(3), new Set(['open_windows_update'])).healthy).toBe(true);
  });
  it('parse', () => expect(parseCrashFacts('{"kernelPower":2,"bugchecks":-1}')).toMatchObject({ kernelPower: 2, bugchecks: 0 }));
  it('de bout en bout', async () => {
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('Get-WinEvent'), reply: () => ok(JSON.stringify(f(3))) },
      { label: 'open', test: (s) => s.includes('ms-settings:windowsupdate'), reply: () => ok() },
    ]);
    const out = await runSkill(crashesSkill(), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out.status).toBe('fixed');
  });
});

const sec = (p: Partial<SecurityFacts> = {}): SecurityFacts => ({
  defender: { serviceEnabled: true, realTime: true, signatureAgeDays: 1 },
  otherAntivirus: [],
  firewall: [{ name: 'Domain', enabled: true }, { name: 'Private', enabled: true }, { name: 'Public', enabled: true }],
  daysSinceUpdate: 10,
  admin: true,
  ...p,
});

describe('sécurité', () => {
  it('en ordre', () => expect(diagnoseSecurity(sec())).toMatchObject({ healthy: true, actions: [] }));
  it('temps réel éteint : le rallumer', () => {
    expect(diagnoseSecurity(sec({ defender: { serviceEnabled: true, realTime: false, signatureAgeDays: 1 } })).actions.map((a) => a.id)).toEqual(['enable_realtime']);
  });
  it('antivirus tiers : Defender volontairement en retrait, aucune action sur Defender', () => {
    const d = diagnoseSecurity(sec({ otherAntivirus: ['Kaspersky'], defender: { serviceEnabled: true, realTime: false, signatureAgeDays: 99 } }));
    expect(d.actions).toEqual([]);
    expect(d.advice.join(' ')).toMatch(/Kaspersky/);
  });
  it('base de virus ancienne : mise à jour', () => {
    expect(diagnoseSecurity(sec({ defender: { serviceEnabled: true, realTime: true, signatureAgeDays: 30 } })).actions.map((a) => a.id)).toEqual(['update_signatures']);
  });
  it('pare-feu éteint : seuls les profils connus entrent dans le script', async () => {
    const d = diagnoseSecurity(sec({ firewall: [{ name: 'Public', enabled: false }, { name: "x'; calc", enabled: false }] }));
    expect(d.actions.map((a) => a.id)).toEqual(['enable_firewall']);
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    await d.actions[0]!.run(runner);
    expect(runner.calls[0]!.script).toContain('-Profile Public ');
    expect(runner.calls[0]!.script).not.toContain('calc');
    checkStructure(runner.calls[0]!.script);
  });
  it('mises à jour anciennes : ouvre Windows Update', () => {
    expect(diagnoseSecurity(sec({ daysSinceUpdate: 200 })).actions.map((a) => a.id)).toEqual(['open_windows_update']);
  });
  it('aucun antivirus : conseil, jamais d’installation automatique', () => {
    const d = diagnoseSecurity(sec({ defender: null }));
    expect(d.problems).toEqual(['no_antivirus']);
    expect(d.actions).toEqual([]);
  });
  it('l’agent ne désactive jamais rien et ne touche pas aux exclusions', async () => {
    const d = diagnoseSecurity(sec({ defender: { serviceEnabled: true, realTime: false, signatureAgeDays: 30 }, firewall: [{ name: 'Public', enabled: false }], daysSinceUpdate: 300 }));
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    for (const a of d.actions) await a.run(runner);
    for (const c of runner.calls) expect(c.script).not.toMatch(/Exclusion|DisableRealtimeMonitoring \$true|-Enabled False|Add-MpPreference/);
  });
  it('parse tolérant', () => {
    const f = parseSecurityFacts('{"defender":null,"otherAntivirus":"Avast","firewall":{"name":"Public","enabled":true}}');
    expect(f.defender).toBeNull();
    expect(f.otherAntivirus).toEqual(['Avast']);
    expect(f.firewall).toHaveLength(1);
  });
});
