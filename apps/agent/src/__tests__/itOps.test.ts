import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { DRIVE_LETTER, UNC_PATH, diagnoseMapDrive, mapDriveCollectScript, mapDriveSkill, parseMapDriveFacts } from '../skills/mapDrive.js';
import { INSTALL_CATALOG, diagnoseInstall, findApp, installCollectScript, installSkill, parseInstallFacts } from '../skills/install.js';
import { COLLECT_SCRIPT as PRINTER_SCRIPT, PRINTER_NAME, diagnosePrinter, parsePrinterFacts, printerSkill } from '../skills/printer.js';
import { SERVER_HOST, diagnoseServer, formatServerTable, parseServerFacts, serverCheckSkill, serverCollectScript, type ServerFacts } from '../skills/serverCheck.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const MODIFYING = /Set-|Start-|Stop-|Remove-|Enable-|Disable-|Clear-|New-Item|New-PSDrive|Restart-|Update-|Checkpoint-/;

describe('imprimante', () => {
  const p = (patch = {}) => ({ name: 'HP LaserJet', status: '3', workOffline: false, isDefault: true, ...patch });
  it('collecte en lecture seule', () => {
    checkStructure(PRINTER_SCRIPT);
    expect(PRINTER_SCRIPT).not.toMatch(MODIFYING);
  });
  it('aucune imprimante physique (PDF, XPS ignorées)', () => {
    const d = diagnosePrinter({ printers: [p({ name: 'Microsoft Print to PDF' })] });
    expect(d.problems).toEqual(['no_printer']);
  });
  it('détectée : propose la page de test', () => {
    const d = diagnosePrinter({ printers: [p()] });
    expect(d.actions.map((a) => a.id)).toEqual(['print_test_page']);
  });
  it('hors connexion : conseil + page de test', () => {
    const d = diagnosePrinter({ printers: [p({ status: '7' })] });
    expect(d.advice.join(' ')).toMatch(/hors connexion|en erreur/);
  });
  it('page de test envoyée : sain', () => {
    expect(diagnosePrinter({ printers: [p()] }, true).healthy).toBe(true);
  });
  it('nom douteux : aucune page de test (le nom n’entre jamais dans un script)', () => {
    expect(diagnosePrinter({ printers: [p({ name: 'HP"; calc #' })] }).actions).toEqual([]);
    expect(PRINTER_NAME.test('Canon MF-3010 (copie 1)')).toBe(true);
    expect(PRINTER_NAME.test('a"b')).toBe(false);
  });
  it('le script de test est bien formé', async () => {
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    await diagnosePrinter({ printers: [p()] }).actions[0]!.run(runner);
    checkStructure(runner.calls[0]!.script);
    expect(runner.calls[0]!.script).toContain("PrintUIEntry /k /n 'HP LaserJet'");
  });
  it('parse tolérant', () => {
    expect(parsePrinterFacts('{"printers":{"name":"X","status":3,"workOffline":true,"isDefault":false}}').printers[0]).toMatchObject({ name: 'X', status: '3', workOffline: true });
  });
  it('de bout en bout : services sains → page de test → le client confirme', async () => {
    const services = JSON.stringify({ services: [{ name: 'Spooler', display: 'Spouleur', state: 'Running', startMode: 'Auto', dependsOn: [] }, { name: 'PrintNotify', display: 'N', state: 'Stopped', startMode: 'Manual', dependsOn: [] }], admin: true, printJobs: 0 });
    const runner = new ScriptedRunner([
      { label: 'collect-services', test: (s) => s.includes('Win32_Service'), reply: () => ok(services) },
      { label: 'collect-printer', test: (s) => s.includes('Win32_Printer'), reply: () => ok(JSON.stringify({ printers: [p()] })) },
      { label: 'test-page', test: (s) => s.includes('PrintUIEntry'), reply: () => ok() },
    ]);
    const ui = new ScriptedConversation();
    const out = await runSkill(printerSkill(), { runner, ui, reporter: new Recorder() });
    expect(runner.count('test-page')).toBe(1);
    expect(out.status === 'fixed' || out.status === 'escalated').toBe(true);
  });
});

const server = (patch: Partial<ServerFacts> = {}): ServerFacts => ({
  host: 'serveur-compta',
  localOk: true,
  dnsAddresses: ['192.168.1.10'],
  pingOk: true,
  ports: [{ port: 445, open: true }, { port: 3389, open: true }, { port: 80, open: false }, { port: 443, open: false }],
  ...patch,
});

describe('test du serveur', () => {
  it('hôte valide / invalide', () => {
    for (const h of ['serveur-compta', '192.168.1.10', 'srv.exemple.ci']) expect(SERVER_HOST.test(h)).toBe(true);
    for (const h of ["a'; calc", 'a b', '-x', 'x-', '', 'a;b', 'a\nb']) expect(SERVER_HOST.test(h)).toBe(false);
    expect(() => serverCollectScript("srv'; calc")).toThrow(/non valide/);
  });
  it('collecte en lecture seule et bien formée', () => {
    const s = serverCollectScript('serveur-compta');
    checkStructure(s);
    expect(s).not.toMatch(MODIFYING);
    expect(s).toContain("'serveur-compta'");
  });
  it('joignable', () => {
    const d = diagnoseServer(server());
    expect(d.healthy).toBe(true);
    expect(d.summary).toMatch(/joignable/);
    expect(d.summary).toMatch(/Partage de fichiers \(445\)\s+🟢/);
    expect(d.summary).toMatch(/Web \(80\)\s+🔴/);
  });
  it('le problème vient de ce PC', () => {
    expect(diagnoseServer(server({ localOk: false }))).toMatchObject({ problems: ['local_network'], needsHuman: false });
  });
  it('nom inconnu (DNS)', () => {
    expect(diagnoseServer(server({ dnsAddresses: [], pingOk: false }))).toMatchObject({ problems: ['dns_name'], needsHuman: true });
  });
  it('serveur muet', () => {
    expect(diagnoseServer(server({ pingOk: false, ports: server().ports.map((p) => ({ ...p, open: false })) })).problems).toEqual(['server_unreachable']);
  });
  it('répond au ping mais aucun service', () => {
    expect(diagnoseServer(server({ ports: server().ports.map((p) => ({ ...p, open: false })) })).problems).toEqual(['services_down']);
  });
  it('partage de fichiers fermé', () => {
    expect(diagnoseServer(server({ ports: [{ port: 445, open: false }, { port: 3389, open: true }] })).problems).toEqual(['smb_closed']);
  });
  it('aucune action, jamais : lecture seule', () => {
    expect(diagnoseServer(server()).actions).toEqual([]);
    expect(formatServerTable(server())).toContain('🟢');
  });
  it('parse : ports hors liste ignorés', () => {
    expect(parseServerFacts('{"pingOk":true,"dnsAddresses":"10.0.0.1","ports":[{"port":22,"open":true},{"port":445,"open":true}]}', 'x').ports).toEqual([{ port: 445, open: true }]);
  });
  it('de bout en bout : serveur éteint → passage de main avec le tableau', async () => {
    const down = server({ pingOk: false, ports: server().ports.map((p) => ({ ...p, open: false })) });
    const runner = new ScriptedRunner([{ label: 'collect', test: (s) => s.includes('ConnectAsync'), reply: () => ok(JSON.stringify(down)) }]);
    const ui = new ScriptedConversation();
    const reporter = new Recorder();
    const out = await runSkill(serverCheckSkill('serveur-compta'), { runner, ui, reporter, machine: 'PC-COMPTA-04' });
    expect(out.status).toBe('escalated');
    expect(ui.said).toMatch(/ORDINATEUR\nPC-COMPTA-04/);
    expect(ui.said).toMatch(/Réponse au ping\s+🔴/);
    expect(reporter.types).toContain('escalated');
  });
});

describe('lecteur réseau', () => {
  const unc = '\\\\srv-fichiers\\Compta';
  it('validation stricte des entrées', () => {
    for (const l of ['D', 'Z']) expect(DRIVE_LETTER.test(l)).toBe(true);
    for (const l of ['C', 'a', 'ZZ', '', "Z'"]) expect(DRIVE_LETTER.test(l)).toBe(false);
    for (const u of [unc, '\\\\srv\\partage$', '\\\\10.0.0.5\\Docs\\Sous dossier']) expect(UNC_PATH.test(u)).toBe(true);
    for (const u of ['\\\\srv\\a"b', '\\\\srv\\', 'srv\\partage', "\\\\srv\\a';calc", '\\\\srv\\a\nb', 'C:\\x']) expect(UNC_PATH.test(u)).toBe(false);
    expect(() => mapDriveCollectScript('C', unc)).toThrow(/Lettre/);
    expect(() => mapDriveCollectScript('Z', "\\\\srv\\a';calc")).toThrow(/Chemin/);
  });
  it('collecte en lecture seule, bien formée', () => {
    const s = mapDriveCollectScript('Z', unc);
    checkStructure(s);
    expect(s).not.toMatch(MODIFYING);
  });
  const f = (patch = {}) => ({ letter: 'Z', unc, currentRoot: '', serverReachable: true, ...patch });
  it('libre et serveur joignable : propose de connecter', () => {
    expect(diagnoseMapDrive(f()).actions.map((a) => a.id)).toEqual(['map_drive']);
  });
  it('déjà connecté au bon endroit (casse et « \\ » final ignorés)', () => {
    expect(diagnoseMapDrive(f({ currentRoot: '\\\\SRV-FICHIERS\\compta\\' })).healthy).toBe(true);
  });
  it('lettre prise par autre chose : on ne remplace rien', () => {
    expect(diagnoseMapDrive(f({ currentRoot: '\\\\autre\\x' }))).toMatchObject({ needsHuman: true, actions: [] });
  });
  it('serveur injoignable : pas d’action', () => {
    expect(diagnoseMapDrive(f({ serverReachable: false }))).toMatchObject({ needsHuman: true, actions: [] });
  });
  it('échec après tentative : technicien', () => {
    expect(diagnoseMapDrive(f(), new Set(['map_drive']))).toMatchObject({ needsHuman: true });
  });
  it('l’action ne contient aucun mot de passe', async () => {
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    await diagnoseMapDrive(f()).actions[0]!.run(runner);
    const script = runner.calls[0]!.script;
    checkStructure(script);
    expect(script).not.toMatch(/Credential|Password|net use/i);
    expect(script).toContain("-Root '\\\\srv-fichiers\\Compta'");
  });
  it('de bout en bout', async () => {
    const state = { mapped: false };
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('Get-PSDrive'), reply: () => ok(JSON.stringify({ currentRoot: state.mapped ? unc : '', serverReachable: true })) },
      { label: 'map', test: (s) => s.includes('New-PSDrive'), reply: () => { state.mapped = true; return ok(); } },
    ]);
    const out = await runSkill(mapDriveSkill('Z', unc), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['map_drive'] });
  });
  it('parse', () => {
    expect(parseMapDriveFacts('{"currentRoot":null,"serverReachable":true}', 'Z', unc)).toMatchObject({ currentRoot: '', serverReachable: true });
  });
});

describe('installation de logiciels', () => {
  it('catalogue fermé : identifiants winget bien formés et uniques', () => {
    const ids = INSTALL_CATALOG.map((a) => a.wingetId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9+.-]+$/);
  });
  it('hors catalogue : refusé', () => {
    expect(findApp('malware')).toBeUndefined();
    expect(() => installSkill('Google.Chrome; calc')).toThrow(/catalogue/);
    expect(() => installCollectScript({ key: 'chrome', label: 'x', wingetId: 'Evil.App' })).toThrow(/catalogue/);
  });
  it('collecte en lecture seule', () => {
    const s = installCollectScript(findApp('chrome')!);
    checkStructure(s);
    expect(s).not.toMatch(/install |uninstall|Set-|Remove-/);
  });
  const chrome = findApp('chrome')!;
  it('winget absent : technicien', () => {
    expect(diagnoseInstall(chrome, { wingetAvailable: false, installed: false })).toMatchObject({ needsHuman: true, actions: [] });
  });
  it('déjà installé : sain', () => {
    expect(diagnoseInstall(chrome, { wingetAvailable: true, installed: true }).healthy).toBe(true);
  });
  it('à installer : une action, source winget, sans option dangereuse', async () => {
    const d = diagnoseInstall(chrome, { wingetAvailable: true, installed: false });
    expect(d.actions.map((a) => a.id)).toEqual(['install_app']);
    const runner = new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);
    await d.actions[0]!.run(runner);
    const s = runner.calls[0]!.script;
    checkStructure(s);
    expect(s).toContain('--id Google.Chrome --exact --source winget');
  });
  it('de bout en bout', async () => {
    const state = { installed: false };
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('winget.exe list'), reply: () => ok(JSON.stringify({ wingetAvailable: true, installed: state.installed })) },
      { label: 'install', test: (s) => s.includes('winget.exe install'), reply: () => { state.installed = true; return ok(); } },
    ]);
    const out = await runSkill(installSkill('vlc'), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['install_app'] });
  });
  it('installation qui échoue : le client est informé, passage de main', async () => {
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('winget.exe list'), reply: () => ok(JSON.stringify({ wingetAvailable: true, installed: false })) },
      { label: 'install', test: (s) => s.includes('winget.exe install'), reply: () => ({ stdout: '', stderr: 'échec', exitCode: 1 }) },
    ]);
    const out = await runSkill(installSkill('vlc'), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out.status).toBe('escalated');
  });
  it('parse', () => expect(parseInstallFacts('{"wingetAvailable":true}')).toEqual({ wingetAvailable: true, installed: false }));
});
