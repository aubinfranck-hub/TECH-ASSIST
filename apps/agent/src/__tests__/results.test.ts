import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { ChatUi } from '../chatServer.js';
import { withStandingConsent } from '../consent.js';
import { formatReport } from '../report.js';
import { repairMyPc, type RepairStep } from '../repairPc.js';
import { buildResults, buildSkillResults, formatResultsText, healthScore, mergeMetrics, rowsFor, summarizeResults, type ResultsView } from '../results.js';
import { cleanupSkill, diagnoseCleanup, parseCleanupFacts, runFreed, type CleanupFacts } from '../skills/cleanup.js';
import { diagnosePerformance, parsePerformanceFacts, type PerformanceFacts } from '../skills/performance.js';
import { disableCandidates, diagnoseStartup, isNonEssential, parseStartupFacts, startupSkill, type StartupItem } from '../skills/startup.js';
import { estimateFor } from '../tasks.js';
import type { Action, Diagnosis, Skill } from '../types.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const anyRunner = (stdout = 'OK') => new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok(stdout) }]);

describe('résultats : lignes avant → après', () => {
  it('espace libre gagné : mieux, avec la variation en clair', () => {
    const [row] = rowsFor({ freeBytes: 10 * GB }, { freeBytes: 12 * GB });
    expect(row).toMatchObject({ id: 'freeBytes', before: '10,0 Go', after: '12,0 Go', change: '+2,0 Go', trend: 'better' });
  });

  it('en dessous de la tolérance (bruit de mesure) : inchangé, jamais « amélioré »', () => {
    const [row] = rowsFor({ freeBytes: 10 * GB }, { freeBytes: 10 * GB + 20 * MB });
    expect(row).toMatchObject({ trend: 'same', change: 'inchangé' });
  });

  it('programmes au démarrage en moins : −3', () => {
    const [row] = rowsFor({ startupActive: 12 }, { startupActive: 9 });
    expect(row).toMatchObject({ before: '12', after: '9', change: '−3', trend: 'better' });
  });

  it('mesures instantanées (mémoire, processeur) : montrées seulement si elles s’améliorent, jamais pour accuser un hasard', () => {
    expect(rowsFor({ ramUsedPercent: 60, cpuPercent: 20 }, { ramUsedPercent: 85, cpuPercent: 70 })).toEqual([]);
    expect(rowsFor({ ramUsedPercent: 60 }, { ramUsedPercent: 61 })).toEqual([]);
    expect(rowsFor({ ramUsedPercent: 80 }, { ramUsedPercent: 55 })[0]).toMatchObject({ trend: 'better', change: '−25 pts' });
  });

  it('une dégradation réelle (disque) est dite, pas cachée', () => {
    expect(rowsFor({ freeBytes: 10 * GB }, { freeBytes: 8 * GB })[0]).toMatchObject({ trend: 'worse', change: '−2,0 Go' });
  });

  it('seules les mesures présentes des deux côtés sont comparées', () => {
    expect(rowsFor({ freeBytes: 1 * GB }, { startupActive: 3 })).toEqual([]);
  });

  it('rassemble les mesures de plusieurs points (la plus récente l’emporte)', () => {
    expect(mergeMetrics([{ metrics: { freeBytes: 1, startupActive: 5 } }, {}, { metrics: { freeBytes: 2 } }])).toEqual({ freeBytes: 2, startupActive: 5 });
  });
});

describe('résultats : indicateur de santé', () => {
  it('100 moins 25 / 12 / 4 selon la gravité, borné entre 0 et 100', () => {
    expect(healthScore([])).toBe(100);
    expect(healthScore([{ severity: 'critical' }, { severity: 'fixable' }, { severity: 'watch' }, { severity: 'ok' }, { severity: 'unknown' }])).toBe(59);
    expect(healthScore(Array.from({ length: 6 }, () => ({ severity: 'critical' as const })))).toBe(0);
  });

  it('analyse complète : score avant → après, lignes chiffrées', () => {
    const view = buildResults(
      [{ severity: 'fixable', metrics: { freeBytes: 5 * GB, startupActive: 14 } }, { severity: 'fixable' }],
      [{ severity: 'ok', metrics: { freeBytes: 9 * GB, startupActive: 6 } }, { severity: 'ok' }],
      [{ title: 'Supprimer les fichiers temporaires', result: 'done', effect: '4,0 Go libérés' }],
    );
    expect(view.score).toEqual({ before: 76, after: 100 });
    expect(view.rows.map((r) => r.id)).toEqual(['freeBytes', 'startupActive']);
    expect(view.headline).toBe('Voici ce qui a changé sur votre ordinateur.');
    expect(view.pendingReboot).toBe(false);
  });

  it('redémarrage en attente : pas de faux chiffres, le score ne bouge pas, on explique pourquoi', () => {
    const view = buildResults([{ severity: 'fixable', metrics: { startupActive: 14 } }], [{ severity: 'ok', metrics: { startupActive: 6 } }], [{ title: 'X', result: 'done' }], true);
    expect(view.rows).toEqual([]);
    expect(view.score).toEqual({ before: 88, after: 88 });
    expect(view.headline).toMatch(/après le redémarrage/);
  });

  it('corrections sans chiffre : on le dit honnêtement, sans inventer de gain', () => {
    const view = buildResults([{ severity: 'fixable' }], [{ severity: 'ok' }], [{ title: 'Vider le cache DNS', result: 'done' }]);
    expect(view.rows).toEqual([]);
    expect(view.headline).toMatch(/ne se chiffrent pas/);
  });

  it('rien de modifié : le dit', () => {
    expect(buildResults([{ severity: 'ok' }], [{ severity: 'ok' }], []).headline).toBe("Aucune modification n'a été faite.");
  });
});

describe('résultats : une seule compétence', () => {
  it('rien de chiffré à montrer : aucune carte', () => {
    expect(buildSkillResults({ freeBytes: 5 * GB }, { freeBytes: 5 * GB }, [{ title: 'X', result: 'done' }])).toBeNull();
    expect(buildSkillResults(undefined, undefined, [])).toBeNull();
  });
  it('une mesure qui bouge, ou un effet mesuré : carte sans score global', () => {
    const a = buildSkillResults({ startupActive: 12 }, { startupActive: 9 }, [{ title: 'X', result: 'done' }])!;
    expect(a.score).toBeUndefined();
    expect(a.rows).toHaveLength(1);
    expect(buildSkillResults(undefined, undefined, [{ title: 'Vider la corbeille', result: 'done', effect: '2,0 Go libérés' }])).not.toBeNull();
  });
});

describe('résultats : texte du rapport et journal du technicien', () => {
  const view: ResultsView = buildResults(
    [{ severity: 'fixable', metrics: { freeBytes: 5 * GB } }],
    [{ severity: 'ok', metrics: { freeBytes: 9 * GB } }],
    [{ title: 'Supprimer les fichiers temporaires', result: 'done', effect: '4,0 Go libérés' }, { title: 'Vider la corbeille', result: 'declined' }],
  );
  it('même contenu que la carte', () => {
    const text = formatResultsText(view);
    expect(text).toContain('RÉSULTATS');
    expect(text).toContain("Santé de l'ordinateur : 88/100 → 100/100");
    expect(text).toContain('• Espace libre sur le disque Windows : 5,0 Go → 9,0 Go (+4,0 Go)');
    expect(text).toContain('✔ Supprimer les fichiers temporaires : 4,0 Go libérés');
    expect(text).not.toContain('Vider la corbeille'); // sans effet mesuré : pas dans les résultats
  });
  it('une ligne pour le journal', () => {
    const line = summarizeResults(view);
    expect(line).toMatch(/^Résultats : santé 88 → 100\/100 ; espace libre sur le disque windows 5,0 Go → 9,0 Go ; supprimer les fichiers temporaires : 4,0 Go libérés$/);
    expect(summarizeResults({ rows: [], actions: [], pendingReboot: false, headline: '' })).toBe('Résultats : aucun changement mesurable');
    expect(summarizeResults({ rows: [], actions: [], pendingReboot: true, headline: '' })).toContain('après redémarrage');
  });
  it('le rapport d’intervention porte les effets et le bloc résultats', () => {
    const out = formatReport({ task: 'T', diagnosis: 'D', actions: [{ title: 'Vider', result: 'done', effect: '1,0 Go libérés' }], test: 'ok', status: 'resolved', durationMs: 1000, results: formatResultsText(view) });
    expect(out).toContain('✔ Vider — 1,0 Go libérés');
    expect(out).toContain('RÉSULTATS');
  });
});

describe('nettoyage mesuré', () => {
  it('runFreed annonce l’effet réel, jamais une estimation', async () => {
    const res = await runFreed(anyRunner('FREED:1288490188'), 'script', 1000);
    expect(res).toEqual({ ok: true, message: '1,2 Go libérés', effect: '1,2 Go libérés' });
  });
  it('moins de 1 Mo : on ne prétend rien', async () => {
    const res = await runFreed(anyRunner('FREED:4096'), 'script', 1000);
    expect(res.ok).toBe(true);
    expect(res.effect).toBeUndefined();
    expect(res.message).toMatch(/presque rien/);
  });
  it('sans ligne FREED : résultat tel quel, sans effet', async () => {
    const res = await runFreed(anyRunner('OK'), 'script', 1000);
    expect(res.effect).toBeUndefined();
  });
  it('un échec reste un échec', async () => {
    const failing = new ScriptedRunner([{ label: 'x', test: () => true, reply: () => ({ stdout: '', stderr: 'Accès refusé', exitCode: 1 }) }]);
    expect((await runFreed(failing, 'script', 1000)).ok).toBe(false);
  });

  const facts = (p: Partial<CleanupFacts> = {}): CleanupFacts => ({ tempBytes: 0, windowsTempBytes: 0, browserCacheBytes: 0, recycleBytes: 0, freeBytes: 200 * GB, totalBytes: 500 * GB, admin: true, ...p });

  it('caches de Windows : action administrateur, comptée dans l’espace récupérable', () => {
    const d = diagnoseCleanup(facts({ systemCacheBytes: 2 * GB }));
    const a = d.actions.find((x) => x.id === 'clean_system_caches')!;
    expect(a).toBeDefined();
    expect(a.requiresAdmin).toBe(true);
    expect(a.id + a.title).not.toMatch(/\d/);
    expect(d.summary).toMatch(/caches de Windows 2,0 Go/);
    expect(d.metrics).toEqual({ freeBytes: 200 * GB, reclaimableBytes: 2 * GB });
  });

  it('script des caches Windows : bien formé, services relancés quoi qu’il arrive, une seule suppression (la fonction prudente)', async () => {
    const runner = anyRunner('FREED:2147483648');
    const a = diagnoseCleanup(facts({ systemCacheBytes: 2 * GB })).actions.find((x) => x.id === 'clean_system_caches')!;
    const res = await a.run(runner);
    expect(res).toMatchObject({ ok: true, effect: '2,0 Go libérés' });
    const script = runner.calls[0]!.script;
    checkStructure(script);
    expect(script).toContain('finally');
    expect(script).toContain('Start-Service');
    expect(script.match(/Remove-Item/g)).toHaveLength(1);
    expect(script).toContain('SoftwareDistribution');
    expect(script).not.toMatch(/Documents|Desktop|\.pst|Cookies|Login Data/i);
  });

  it('chaque nettoyage mesure avant et après', async () => {
    const d = diagnoseCleanup(facts({ tempBytes: 1 * GB, browserCacheBytes: 1 * GB, recycleBytes: 1 * GB, systemCacheBytes: 1 * GB }));
    expect(d.actions.map((a) => a.id)).toEqual(['clean_temp', 'clear_browser_cache', 'empty_recycle_bin', 'clean_system_caches']);
    const runner = anyRunner('FREED:5242880');
    for (const a of d.actions) expect(await a.run(runner)).toMatchObject({ ok: true, effect: '5 Mo libérés' });
    for (const c of runner.calls) {
      checkStructure(c.script);
      expect(c.script).toContain('FREED:');
    }
  });

  it('parse : caches de Windows absents = 0', () => {
    expect(parseCleanupFacts('{"tempBytes":1}').systemCacheBytes).toBe(0);
    expect(parseCleanupFacts('{"systemCacheBytes":42}').systemCacheBytes).toBe(42);
  });

  it('de bout en bout : l’espace gagné est mesuré à la relecture et montré dans la carte', async () => {
    const state = { cleaned: false };
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('ConvertTo-Json'), reply: () => ok(JSON.stringify(facts({ tempBytes: state.cleaned ? 0 : 3 * GB, freeBytes: state.cleaned ? 33 * GB : 30 * GB }))) },
      { label: 'clean', test: (s) => s.includes('Remove-Item'), reply: () => { state.cleaned = true; return ok('FREED:3221225472'); } },
    ]);
    const ui = new ScriptedConversation();
    const reporter = new Recorder();
    const out = await runSkill(cleanupSkill(), { runner, ui, reporter });
    expect(out.status).toBe('fixed');
    expect(ui.said).toContain('✔ Supprimer les fichiers temporaires : 3,0 Go libérés');
    expect(ui.resultCards).toHaveLength(1);
    const card = ui.resultCards[0]!;
    expect(card.score).toBeUndefined();
    expect(card.rows.map((r) => `${r.id}:${r.trend}`)).toEqual(['freeBytes:better', 'reclaimableBytes:better']);
    expect(card.actions).toEqual([{ title: 'Supprimer les fichiers temporaires', result: 'done', effect: '3,0 Go libérés' }]);
    expect(ui.said).toContain('RÉSULTATS');
    // le technicien voit l'effet dans son journal
    expect(reporter.events.find((e) => e.type === 'action_done')).toMatchObject({ message: '3,0 Go libérés', details: { effect: '3,0 Go libérés' } });
    expect(reporter.events.find((e) => e.type === 'verified' && (e.details as { results?: boolean } | undefined)?.results)).toBeDefined();
  });
});

const item = (name: string, kind: StartupItem['kind'] = 'run-user', enabled = true): StartupItem => ({ name, location: 'HKCU\\Run', kind, enabled });

describe('démarrage : désactivation réelle', () => {
  it('programmes sans intérêt au démarrage : reconnus', () => {
    for (const n of ['Spotify', 'Discord', 'Steam', 'EpicGamesLauncher', 'Skype', 'Microsoft Teams', 'AdobeGCInvoker-1.0', 'Adobe Creative Cloud', 'iTunesHelper', 'OperaBrowserAssistant'.replace('OperaBrowserAssistant', 'Opera Browser Assistant'), 'uTorrent']) {
      expect(isNonEssential(n), n).toBe(true);
    }
  });

  it('antivirus, pilotes, sauvegarde, synchronisation, accès à distance : jamais touchés', () => {
    for (const n of ['SecurityHealth', 'Windows Defender', 'RtkAudUService', 'Realtek HD Audio', 'NVIDIA Capture', 'Intel Graphics', 'OneDrive', 'Dropbox Backup', 'TeamViewer', 'AnyDesk', 'RustDesk', 'Tech Assist', 'ExpressVPN', 'Synaptics Pointing', 'Bluetooth Manager', 'Kaspersky Protection']) {
      expect(isNonEssential(n), n).toBe(false);
    }
    // même quand le nom ressemble à une application listée
    expect(isNonEssential('Discord Backup')).toBe(false);
    expect(isNonEssential('Spotify VPN helper')).toBe(false);
  });

  it('candidats : actifs, dans une clé Run, sans doublon, nom sûr', () => {
    const c = disableCandidates({
      admin: true,
      items: [
        item('Spotify'),
        item('Spotify'), // doublon
        item('Discord', 'run-machine'),
        item('Steam', 'run-user', false), // déjà désactivé
        item('Skype', 'folder-user'), // raccourci du dossier Démarrage : au client
        item('Zoom', 'other'),
        item('Teams\nrm', 'run-user'), // caractère interdit dans un script
        item('OneDrive'),
      ],
    });
    expect(c.map((i) => `${i.kind}:${i.name}`)).toEqual(['run-user:Spotify', 'run-machine:Discord']);
  });

  it('diagnostic : propose la désactivation (titre stable), avec les noms dans l’explication', () => {
    const d = diagnoseStartup({ admin: true, items: [item('Spotify'), item('Discord'), item('OneDrive')] });
    expect(d.healthy).toBe(false);
    expect(d.problems).toEqual(['startup_nonessential']);
    expect(d.actions.map((a) => a.id)).toEqual(['disable_startup_apps']);
    const a = d.actions[0]!;
    expect(a.id + a.title).not.toMatch(/\d/);
    expect(a.explanation).toContain('Spotify, Discord');
    expect(a.explanation).toMatch(/PAS désinstallés/);
    expect(a.verified).toBe(false);
    expect(a.requiresAdmin).toBe(false); // clés de l'utilisateur seulement
    expect(d.metrics).toEqual({ startupActive: 3 });
  });

  it('une entrée de la machine entière exige les droits administrateur', () => {
    const d = diagnoseStartup({ admin: true, items: [item('Spotify'), item('Discord', 'run-machine')] });
    expect(d.actions[0]!.requiresAdmin).toBe(true);
  });

  it('le compte des programmes ignore ceux déjà désactivés', () => {
    expect(diagnoseStartup({ admin: true, items: [item('OneDrive'), item('Steam', 'run-user', false)] }).metrics).toEqual({ startupActive: 1 });
  });

  it('déjà tenté : jamais reproposé ; la page des Paramètres prend le relais si le démarrage reste chargé', () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`Outil${i}`));
    const d = diagnoseStartup({ admin: true, items: [item('Spotify'), ...many] }, false, new Set(['disable_startup_apps']));
    expect(d.actions.map((a) => a.id)).toEqual(['open_startup_settings']);
  });

  it('la désactivation passe avant la page des Paramètres', () => {
    const many = Array.from({ length: 12 }, (_, i) => item(`Outil${i}`));
    expect(diagnoseStartup({ admin: true, items: [item('Spotify'), ...many] }).actions.map((a) => a.id)).toEqual(['disable_startup_apps']);
  });

  it('script : valeur « StartupApproved » du Gestionnaire des tâches, rien n’est supprimé ni désinstallé', async () => {
    const runner = anyRunner('DISABLED:2');
    const d = diagnoseStartup({ admin: true, items: [item('Spotify'), item("Spotify's Helper", 'run-machine')] });
    const res = await d.actions[0]!.run(runner);
    expect(res).toEqual({ ok: true, message: '2 programmes retirés du démarrage', effect: '2 programmes retirés du démarrage' });
    const script = runner.calls[0]!.script;
    checkStructure(script);
    expect(script).toContain('StartupApproved');
    expect(script).toContain("'Spotify'");
    expect(script).toContain("'Spotify''s Helper'"); // apostrophe échappée
    expect(script).toContain('[byte[]](3,0,0,0,0,0,0,0,0,0,0,0)');
    expect(script).not.toMatch(/Remove-Item|RemoveItem|DeleteValue|Uninstall|Stop-Process|Disable-ScheduledTask/i);
    // seules les clés Run connues sont visées
    expect(script).toContain('Software\\Microsoft\\Windows\\CurrentVersion\\Run');
    expect(script).toContain('SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run');
  });

  it('programme 32 bits de la machine : clé WOW6432Node et valeur Run32', async () => {
    const runner = anyRunner('DISABLED:1');
    await diagnoseStartup({ admin: true, items: [item('Skype', 'run-machine32')] }).actions[0]!.run(runner);
    expect(runner.calls[0]!.script).toContain('SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run');
    expect(runner.calls[0]!.script).toContain('StartupApproved\\Run32');
  });

  it('un seul programme : accord au singulier ; aucun trouvé : on ne prétend rien', async () => {
    const one = await diagnoseStartup({ admin: true, items: [item('Spotify')] }).actions[0]!.run(anyRunner('DISABLED:1'));
    expect(one.effect).toBe('1 programme retiré du démarrage');
    const none = await diagnoseStartup({ admin: true, items: [item('Spotify')] }).actions[0]!.run(anyRunner('DISABLED:0'));
    expect(none.ok).toBe(true);
    expect(none.effect).toBeUndefined();
  });

  it('parse : état activé / désactivé et type d’entrée', () => {
    const f = parseStartupFacts(JSON.stringify({ items: [{ name: 'Spotify', location: 'HKU\\Run', kind: 'run-user', enabled: false }, { name: 'X', location: 'Y', kind: 'inconnu' }], admin: false }));
    expect(f.items.map((i) => [i.enabled, i.kind])).toEqual([[false, 'run-user'], [true, 'other']]);
    expect(f.admin).toBe(false);
  });

  it('de bout en bout : désactivation, relecture, comparaison chiffrée dans la carte', async () => {
    const state = { disabled: false };
    const items = () => [
      { name: 'Spotify', location: 'HKU\\Run', kind: 'run-user', enabled: !state.disabled },
      { name: 'Discord', location: 'HKU\\Run', kind: 'run-user', enabled: !state.disabled },
      { name: 'OneDrive', location: 'HKU\\Run', kind: 'run-user', enabled: true },
    ];
    const runner = new ScriptedRunner([
      { label: 'collect', test: (s) => s.includes('Win32_StartupCommand'), reply: () => ok(JSON.stringify({ items: items(), admin: true })) },
      { label: 'disable', test: (s) => s.includes('StartupApproved') && s.includes('DISABLED:'), reply: () => { state.disabled = true; return ok('DISABLED:2'); } },
    ]);
    const ui = new ScriptedConversation();
    const out = await runSkill(startupSkill(), { runner, ui, reporter: new Recorder() });
    expect(out.status).toBe('fixed');
    expect(ui.said).toContain('✔ Désactiver au démarrage les programmes inutiles : 2 programmes retirés du démarrage');
    expect(ui.resultCards[0]!.rows).toEqual([{ id: 'startupActive', label: 'Programmes lancés au démarrage', before: '3', after: '1', change: '−2', trend: 'better' }]);
    expect(runner.calls.filter((c) => c.label === 'disable')).toHaveLength(1);
  });

  it('refus du client : rien n’est modifié', async () => {
    const runner = new ScriptedRunner([{ label: 'collect', test: (s) => s.includes('Win32_StartupCommand'), reply: () => ok(JSON.stringify({ items: [{ name: 'Spotify', location: 'HKU\\Run', kind: 'run-user', enabled: true }], admin: true })) }]);
    const out = await runSkill(startupSkill(), { runner, ui: new ScriptedConversation({ approve: { disable_startup_apps: false } }), reporter: new Recorder() });
    expect(out.status).toBe('declined');
    expect(runner.calls.every((c) => c.label === 'collect')).toBe(true);
  });
});

describe('performances : mode d’alimentation', () => {
  const perf = (p: Partial<PerformanceFacts> = {}): PerformanceFacts => ({ totalRamBytes: 8 * GB, freeRamBytes: 4 * GB, cpuPercent: 20, uptimeDays: 1, top: [], ...p });
  const SAVER = 'a1841308-3541-4fab-bc81-f71556f20b4a';

  it('mode « Économie d’énergie » : proposé de passer en « Équilibré »', () => {
    const d = diagnosePerformance(perf({ powerScheme: SAVER }));
    expect(d.problems).toContain('power_saver');
    expect(d.healthy).toBe(false);
    const a = d.actions.find((x) => x.id === 'set_balanced_power')!;
    expect(a.id + a.title).not.toMatch(/\d/);
    expect(a.explanation).toMatch(/autonomie/);
  });

  it('autre mode ou inconnu : rien à faire', () => {
    expect(diagnosePerformance(perf({ powerScheme: '381b4222-f694-41f0-9685-ff5bb260df2e' })).actions).toEqual([]);
    expect(diagnosePerformance(perf({ powerScheme: null })).actions).toEqual([]);
  });

  it('déjà tenté : jamais reproposé', () => {
    expect(diagnosePerformance(perf({ powerScheme: SAVER }), new Set(['set_balanced_power'])).actions).toEqual([]);
  });

  it('script : active seulement le mode Équilibré, échec signalé', async () => {
    const runner = anyRunner();
    const a = diagnosePerformance(perf({ powerScheme: SAVER })).actions[0] as Action;
    const res = await a.run(runner);
    expect(res).toMatchObject({ ok: true, effect: expect.stringContaining('Équilibré') });
    const script = runner.calls[0]!.script;
    checkStructure(script);
    expect(script).toContain('powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e');
    const failing = new ScriptedRunner([{ label: 'x', test: () => true, reply: () => ({ stdout: '', stderr: 'refusé', exitCode: 1 }) }]);
    expect((await a.run(failing)).ok).toBe(false);
  });

  it('mesures : mémoire utilisée en pourcentage, processeur', () => {
    expect(diagnosePerformance(perf({ freeRamBytes: 2 * GB })).metrics).toEqual({ ramUsedPercent: 75, cpuPercent: 20 });
    expect(diagnosePerformance(perf({ cpuPercent: null })).metrics).toEqual({ ramUsedPercent: 50 });
  });

  it('parse : identifiant du mode valide seulement (jamais du texte libre)', () => {
    expect(parsePerformanceFacts(JSON.stringify({ powerScheme: SAVER.toUpperCase() })).powerScheme).toBe(SAVER);
    expect(parsePerformanceFacts(JSON.stringify({ powerScheme: "x'; calc" })).powerScheme).toBeNull();
    expect(parsePerformanceFacts('{}').powerScheme).toBeNull();
  });
});

describe('durées prévues des nouvelles actions', () => {
  it('connues (pas l’estimation par défaut)', () => {
    const fallback = estimateFor('action_inconnue');
    for (const id of ['clean_system_caches', 'disable_startup_apps', 'set_balanced_power']) expect(estimateFor(id)).not.toEqual(fallback);
  });
});

describe('RÉPARER MON PC : résultats', () => {
  const diag = (p: Partial<Diagnosis>): Diagnosis => ({ summary: 'ok', problems: [], actions: [], advice: [], healthy: true, needsHuman: false, ...p });

  /** Étape dont la correction fait baisser « programmes au démarrage » et rend « effect » au client. */
  function startupStep(opts: { reboot?: boolean } = {}): RepairStep {
    const state = { fixed: false };
    const skill: Skill = {
      id: 'startup',
      title: 'Démarrage',
      verifyQuestion: '?',
      async diagnose() {
        if (state.fixed) return diag({ summary: '4 programmes au démarrage', metrics: { startupActive: 4, freeBytes: 14 * GB } });
        const fix: Action = {
          id: 'disable_startup_apps',
          title: 'Désactiver au démarrage les programmes inutiles',
          explanation: 'x',
          requiresAdmin: false,
          verified: false,
          needsReboot: opts.reboot,
          run: async () => {
            state.fixed = true;
            return { ok: true, message: '6 programmes retirés du démarrage', effect: '6 programmes retirés du démarrage' };
          },
        };
        return diag({ summary: '10 programmes au démarrage', healthy: false, problems: ['x'], actions: [fix], metrics: { startupActive: 10, freeBytes: 10 * GB } });
      },
    };
    return { id: 'startup', label: 'Démarrage', build: () => skill };
  }
  const healthy = (id: string): RepairStep => ({ id, label: id, build: () => ({ id, title: id, verifyQuestion: '?', diagnose: async () => diag({}) }) });
  const ctx = (ui: ScriptedConversation, reporter = new Recorder()) => ({ runner: anyRunner(), ui, reporter, machine: 'PC-1' });

  it('carte « Résultats » : score avant → après, ligne chiffrée, effet de l’action ; même contenu dans le rapport', async () => {
    const ui = new ScriptedConversation();
    const reporter = new Recorder();
    await repairMyPc(ctx(ui, reporter), [startupStep(), healthy('b')]);
    expect(ui.resultCards).toHaveLength(1);
    const card = ui.resultCards[0]!;
    expect(card.score).toEqual({ before: 88, after: 100 });
    expect(card.rows.map((r) => [r.id, r.before, r.after, r.change])).toEqual([['freeBytes', '10,0 Go', '14,0 Go', '+4,0 Go'], ['startupActive', '10', '4', '−6']]);
    expect(card.actions).toEqual([{ title: 'Désactiver au démarrage les programmes inutiles', result: 'done', effect: '6 programmes retirés du démarrage' }]);
    const report = ui.infos.find((m) => m.startsWith("RAPPORT D'INTERVENTION"))!;
    expect(report).toContain('RÉSULTATS');
    expect(report).toContain("Santé de l'ordinateur : 88/100 → 100/100");
    expect(report).toContain('✔ Désactiver au démarrage les programmes inutiles — 6 programmes retirés du démarrage');
    // le technicien lit la même chose
    expect(reporter.events.some((e) => e.type === 'verified' && /santé 88 → 100\/100/.test(e.message))).toBe(true);
  });

  it('redémarrage accepté : aucun chiffre avant le redémarrage, le dit', async () => {
    const ui = new ScriptedConversation();
    await repairMyPc(ctx(ui), [startupStep({ reboot: true })]);
    const card = ui.resultCards[0]!;
    expect(card.pendingReboot).toBe(true);
    expect(card.rows).toEqual([]);
    expect(card.headline).toMatch(/après le redémarrage/);
    expect(card.actions[0]!.effect).toBe('6 programmes retirés du démarrage');
  });

  it('rien à corriger, ou refus : aucune carte', async () => {
    const ui = new ScriptedConversation();
    await repairMyPc(ctx(ui), [healthy('a')]);
    expect(ui.resultCards).toEqual([]);
    const refusing = new ScriptedConversation({ approve: { confirm_only: false } });
    await repairMyPc(ctx(refusing), [startupStep()]);
    expect(refusing.resultCards).toEqual([]);
    expect(refusing.said).not.toContain('RÉSULTATS');
  });

  it('l’accord unique (withStandingConsent) transmet la carte à la fenêtre', async () => {
    const ui = new ScriptedConversation();
    await repairMyPc(ctx(withStandingConsent(ui) as ScriptedConversation), [startupStep()]);
    expect(ui.resultCards).toHaveLength(1);
  });

  it('une interface sans carte (terminal, journal) reçoit le texte du rapport : aucune erreur', async () => {
    const infos: string[] = [];
    const bare = {
      info: (m: string) => void infos.push(m),
      confirmAction: async () => true,
      confirmFixed: async () => true,
    };
    await repairMyPc({ runner: anyRunner(), ui: bare, reporter: new Recorder(), machine: 'PC-1' }, [startupStep()]);
    expect(infos.join('\n')).toContain('RÉSULTATS');
  });
});

describe('ChatUi : carte « Résultats »', () => {
  interface Ev {
    type: string;
    view?: ResultsView;
    seq: number;
  }
  function listen(ui: ChatUi) {
    const url = new URL(ui.url);
    const events: Ev[] = [];
    let buffer = '';
    const req = request({ host: '127.0.0.1', port: Number(url.port), path: `/events?t=${url.searchParams.get('t')}` }, (res) => {
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame.split('\n').find((l) => l.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)) as Ev);
        }
      });
    });
    req.on('error', () => undefined);
    req.end();
    return { events, stop: () => req.destroy() };
  }
  const wait = () => new Promise((r) => setTimeout(r, 80));

  const view = buildResults([{ severity: 'fixable', metrics: { startupActive: 10 } }], [{ severity: 'ok', metrics: { startupActive: 4 } }], [{ title: 'Désactiver', result: 'done', effect: '6 programmes retirés du démarrage' }]);

  it('l’événement porte la vue complète ; une page rechargée la retrouve', async () => {
    const ui = await ChatUi.start({ openWaitMs: 600_000, graceMs: 600_000 });
    const feed = listen(ui);
    ui.results(view);
    await wait();
    const ev = feed.events.find((e) => e.type === 'results')!;
    expect(ev.view).toEqual(view);
    const reloaded = listen(ui);
    await wait();
    expect(reloaded.events.filter((e) => e.type === 'results')).toHaveLength(1);
    feed.stop();
    reloaded.stop();
    await ui.close();
  });

  it('la page affiche la carte sans HTML construit à la volée', async () => {
    const ui = await ChatUi.start({ openWaitMs: 600_000, graceMs: 600_000 });
    const url = new URL(ui.url);
    const html = await (await fetch(ui.url, { headers: { Host: `127.0.0.1:${url.port}` } })).text();
    expect(html).toContain("ev.type === 'results'");
    expect(html).toContain('function showResults(v)');
    expect(html).toContain('.results {');
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    await ui.close();
  });
});
