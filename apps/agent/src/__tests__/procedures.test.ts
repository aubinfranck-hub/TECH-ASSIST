import { describe, expect, it } from 'vitest';
import { actScript, actionIdFor, observeScript, parseFacts } from '../procedures/builders.js';
import { compileProcedure } from '../procedures/compile.js';
import {
  CATALOG_VERSION,
  PRIMITIVES,
  TOOL_IDS,
  describeCatalog,
  expectationMet,
  isAllowedHost,
  validateArgs,
  validateProcedure,
  type Args,
  type ToolId,
} from '../procedures/manifest.js';
import { runSkill } from '../agent.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok, fail } from './fakeScripts.js';

const procedure = (patch: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  title: 'Le spouleur ne démarre pas',
  summary: "Le service d'impression est arrêté, rien ne sort de l'imprimante.",
  keywords: ['imprimante', 'spooler', 'impression'],
  verifyQuestion: 'Pouvez-vous imprimer maintenant ?',
  checks: [{ id: 'c1', tool: 'service_status', args: { name: 'Spooler' }, expect: { fact: 'status', op: 'eq', value: 'running' }, problem: "Le service d'impression est arrêté." }],
  fixes: [{ id: 'f1', tool: 'service_start', args: { name: 'Spooler' }, why: "Il faut que ce service tourne pour imprimer." }],
  advice: [],
  ...patch,
});

describe('catalogue — paramètres', () => {
  it('accepte des paramètres conformes et normalise (lettre de disque, .exe)', () => {
    expect(validateArgs('service_status', { name: 'Spooler' })).toEqual({ ok: true, value: { name: 'Spooler' } });
    expect(validateArgs('process_info', { name: 'OUTLOOK.EXE' })).toEqual({ ok: true, value: { name: 'OUTLOOK' } });
    expect(validateArgs('disk_free', { drive: 'c:' })).toEqual({ ok: true, value: { drive: 'C' } });
    expect(validateArgs('event_errors', { log: 'Application', hours: 24 })).toMatchObject({ ok: true });
    expect(validateArgs('explorer_restart', undefined)).toEqual({ ok: true, value: {} });
  });

  it.each([
    "Spooler'; Remove-Item C:\\ -Recurse #",
    'Spooler" -and (calc)',
    '$(calc)',
    'a b',
    'a`b',
    'Spooler\nStop-Computer',
    'Spooler’; calc',
    '../x',
    '*',
    '',
    'x'.repeat(41),
  ])('refuse un nom de service piégé : %s', (name) => {
    expect(validateArgs('service_status', { name }).ok).toBe(false);
    expect(validateArgs('service_start', { name }).ok).toBe(false);
  });

  it('refuse les paramètres inconnus, manquants, ou du mauvais type', () => {
    expect(validateArgs('service_status', { name: 'x', extra: 1 }).ok).toBe(false);
    expect(validateArgs('service_status', {}).ok).toBe(false);
    expect(validateArgs('service_status', { name: 12 }).ok).toBe(false);
    expect(validateArgs('event_errors', { log: 'Application', hours: '24' }).ok).toBe(false);
    expect(validateArgs('event_errors', { log: 'Application', hours: 1000 }).ok).toBe(false);
    expect(validateArgs('event_errors', { log: 'Security', hours: 24 }).ok).toBe(false);
    expect(validateArgs('service_status', JSON.parse('{"__proto__": {"x": 1}, "name": "ok"}')).ok).toBe(false);
    expect(validateArgs('inconnue', {}).ok).toBe(false);
    expect(validateArgs('toString', {}).ok).toBe(false);
    expect(validateArgs('service_status', [] as unknown as object).ok).toBe(false);
  });

  it('protège les services du système et de la sécurité, et ne désactive jamais un service', () => {
    for (const name of ['WinDefend', 'mpssvc', 'EventLog', 'RpcSs', 'wscsvc', 'BFE']) {
      expect(validateArgs('service_restart', { name }).ok, name).toBe(false);
      expect(validateArgs('service_set_startup', { name, mode: 'Manual' }).ok, name).toBe(false);
    }
    expect(validateArgs('service_set_startup', { name: 'Spooler', mode: 'Disabled' }).ok).toBe(false);
    expect(validateArgs('service_set_startup', { name: 'Spooler', mode: 'Manual' }).ok).toBe(true);
    // accès à distance et partages : jamais démarrés
    for (const name of ['TermService', 'RemoteRegistry', 'WinRM', 'LanmanServer']) expect(validateArgs('service_start', { name }).ok, name).toBe(false);
    // lecture seule : permise partout
    expect(validateArgs('service_status', { name: 'WinDefend' }).ok).toBe(true);
  });

  it('protège les processus du système, de PowerShell et de Tech Assist', () => {
    for (const name of ['lsass', 'csrss', 'svchost', 'explorer', 'powershell', 'pwsh', 'MsMpEng', 'tech-assist-agent', 'TechAssist']) {
      expect(validateArgs('process_stop', { name }).ok, name).toBe(false);
    }
    expect(validateArgs('process_stop', { name: 'OUTLOOK' }).ok).toBe(true);
    expect(validateArgs('process_info', { name: 'lsass' }).ok).toBe(true); // lecture seule
  });

  it("n'autorise que des hôtes de test connus ou locaux", () => {
    for (const host of ['8.8.8.8', 'www.google.com', '192.168.1.10', '10.0.0.5', '172.16.0.1', 'serveur-compta', 'srv01.local', 'nas.corp']) expect(isAllowedHost(host), host).toBe(true);
    for (const host of ['evil.com', 'attacker.example.org', '1.2.3.4', '192.168.1.300', '172.32.0.1', '203.0.113.9', 'a.b.c', 'x;calc', '']) expect(isAllowedHost(host), host).toBe(false);
    expect(validateArgs('net_port', { host: 'serveur-compta', port: 445 }).ok).toBe(true);
    expect(validateArgs('net_port', { host: 'serveur-compta', port: 22 }).ok).toBe(false);
    expect(validateArgs('net_ping', { host: 'evil.com' }).ok).toBe(false);
  });

  it('ne permet de désactiver que le proxy, pas de l’activer', () => {
    expect(validateArgs('setting_set', { key: 'proxy', value: 'off' }).ok).toBe(true);
    expect(validateArgs('setting_set', { key: 'proxy', value: 'on' }).ok).toBe(false);
    expect(validateArgs('setting_set', { key: 'fast_startup', value: 'off' }).ok).toBe(true);
    expect(validateArgs('setting_set', { key: 'defender', value: 'off' }).ok).toBe(false);
  });
});

describe('catalogue — procédure', () => {
  it('accepte une procédure conforme', () => {
    const r = validateProcedure(procedure());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.keywords).toEqual(['imprimante', 'spooler', 'impression']);
      expect(r.value.fixes[0]!.tool).toBe('service_start');
    }
  });

  it('refuse tout ce qui sort du catalogue ou de la forme', () => {
    const bads: [string, Record<string, unknown>][] = [
      ['champ inconnu', { run: 'Remove-Item C:\\' }],
      ['mauvaise version', { schemaVersion: 2 }],
      ['plus de 6 corrections', { fixes: Array.from({ length: 7 }, (_, i) => ({ id: `f${i + 1}`, tool: 'explorer_restart', args: {}, why: 'Relancer' })) }],
      ['correction avec une opération de lecture', { fixes: [{ id: 'f1', tool: 'service_status', args: { name: 'Spooler' }, why: 'Regarder le service' }] }],
      ['vérification avec une opération de modification', { checks: [{ id: 'c1', tool: 'service_start', args: { name: 'Spooler' }, expect: { fact: 'status', op: 'eq', value: 'running' }, problem: 'Service arrêté' }] }],
      ['constat inconnu', { checks: [{ id: 'c1', tool: 'service_status', args: { name: 'Spooler' }, expect: { fact: 'cpu', op: 'eq', value: 1 }, problem: 'Service arrêté' }] }],
      ['type du constat', { checks: [{ id: 'c1', tool: 'service_status', args: { name: 'Spooler' }, expect: { fact: 'exists', op: 'eq', value: 'oui' }, problem: 'Service absent' }] }],
      ['comparaison impossible', { checks: [{ id: 'c1', tool: 'process_info', args: { name: 'x1' }, expect: { fact: 'running', op: 'lt', value: true }, problem: 'Programme fermé' }] }],
      ['onlyIf inconnu', { fixes: [{ id: 'f1', tool: 'service_start', args: { name: 'Spooler' }, why: 'Démarrer le service', onlyIf: ['c9'] }] }],
      ['identifiant répété', { checks: [procedure().checks[0], procedure().checks[0]] }],
      ['aucun remède', { fixes: [], advice: [] }],
      ['un seul mot-clé', { keywords: ['imprimante'] }],
      ['nom de service piégé', { fixes: [{ id: 'f1', tool: 'service_start', args: { name: "x'; calc" }, why: 'Démarrer le service' }] }],
      ['service protégé', { fixes: [{ id: 'f1', tool: 'service_restart', args: { name: 'WinDefend' }, why: 'Relancer la sécurité' }] }],
    ];
    for (const [label, patch] of bads) expect(validateProcedure(procedure(patch)).ok, label).toBe(false);
    expect(validateProcedure('Remove-Item C:\\').ok).toBe(false);
    expect(validateProcedure(null).ok).toBe(false);
    expect(validateProcedure([]).ok).toBe(false);
  });

  it('nettoie les textes affichés (balises, caractères de contrôle, longueur)', () => {
    const r = validateProcedure(procedure({ title: '<b>Le spouleur</b>\u0007 bloque', advice: ['Ouvrez <script>alert(1)</script> les paramètres'] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe('bLe spouleur/b bloque');
      expect(r.value.advice[0]).not.toMatch(/[<>]/);
    }
  });

  it('évalue les attentes : un constat absent ne vérifie jamais l’attente', () => {
    expect(expectationMet({ status: 'running' }, { fact: 'status', op: 'eq', value: 'running' })).toBe(true);
    expect(expectationMet({ status: 'stopped' }, { fact: 'status', op: 'eq', value: 'running' })).toBe(false);
    expect(expectationMet({}, { fact: 'status', op: 'eq', value: 'running' })).toBe(false);
    expect(expectationMet({}, { fact: 'status', op: 'ne', value: 'stopped' })).toBe(false);
    expect(expectationMet({ freeGB: 3 }, { fact: 'freeGB', op: 'gt', value: 5 })).toBe(false);
    expect(expectationMet({ freeGB: 30 }, { fact: 'freeGB', op: 'gt', value: 5 })).toBe(true);
    expect(expectationMet({ status: 'Running' }, { fact: 'status', op: 'contains', value: 'run' })).toBe(true);
  });

  it("décrit le catalogue pour l'IA sans oublier d'opération", () => {
    const text = describeCatalog();
    for (const tool of TOOL_IDS) expect(text).toContain(tool);
    expect(CATALOG_VERSION).toBe(1);
  });
});

describe('scripts PowerShell du catalogue', () => {
  const sample: Record<string, Args> = {
    service_status: { name: 'Spooler' },
    process_info: { name: 'OUTLOOK' },
    event_errors: { log: 'Application', hours: 24, source: 'Outlook' },
    disk_free: { drive: 'C' },
    net_ping: { host: '8.8.8.8' },
    net_port: { host: 'serveur-compta', port: 445 },
    dns_resolve: { name: 'www.google.com' },
    program_installed: { name: 'Outlook' },
    setting_read: { key: 'proxy' },
    service_start: { name: 'Spooler' },
    service_restart: { name: 'Spooler' },
    service_set_startup: { name: 'Spooler', mode: 'Automatic' },
    process_stop: { name: 'OUTLOOK' },
    explorer_restart: {},
    explorer_caches: {},
    net_reset: { what: 'flush_dns' },
    setting_set: { key: 'fast_startup', value: 'off' },
  };

  it('couvre toutes les opérations du catalogue', () => {
    expect(Object.keys(sample).sort()).toEqual([...TOOL_IDS].sort());
  });

  it.each(TOOL_IDS)('%s : script valide, enveloppé, sans valeur brute', (tool) => {
    const args = sample[tool]!;
    expect(validateArgs(tool, args).ok).toBe(true);
    const script = PRIMITIVES[tool].role === 'observe' ? observeScript(tool, args) : actScript(tool, args).script;
    expect(script).toContain("$ErrorActionPreference = 'Stop'");
    // Un nom ne figure jamais qu'entre apostrophes.
    if (typeof args.name === 'string') expect(script).toContain(`'${args.name}'`);
  });

  it("une opération de lecture n'a jamais de verbe de modification", () => {
    const forbidden = /\b(Set-|Remove-|Stop-|Start-|Restart-|New-|Clear-|Disable-|Enable-|Invoke-Expression|iex|netsh|shutdown|sc\.exe|reg\s+(add|delete))/i;
    for (const tool of TOOL_IDS) {
      if (PRIMITIVES[tool].role !== 'observe') continue;
      expect(observeScript(tool, sample[tool]!), tool).not.toMatch(forbidden);
    }
  });

  it('lit uniquement les constats annoncés, du bon type', () => {
    expect(parseFacts('service_status', '{"exists":true,"status":"Running","startType":"Auto","extra":"x"}')).toEqual({ exists: true, status: 'running', startType: 'automatic' });
    expect(parseFacts('service_status', '{"exists":true,"status":"StopPending","startType":"Disabled"}')).toEqual({ exists: true, status: 'pending', startType: 'disabled' });
    expect(parseFacts('process_info', '{"running":"oui","count":2,"memoryMB":120}')).toEqual({ count: 2, memoryMB: 120 });
    expect(parseFacts('disk_free', '{}')).toEqual({});
    expect(() => parseFacts('disk_free', 'pas du json')).toThrow();
  });

  it('nomme les actions pour le suivi des durées', () => {
    expect(actionIdFor('service_start', { name: 'Spooler' }, 'f1')).toBe('service_start:f1');
    expect(actionIdFor('net_reset', { what: 'winsock' }, 'f2')).toBe('reset_network_stack:f2');
    expect(actionIdFor('net_reset', { what: 'flush_dns' }, 'f2')).toBe('flush_dns:f2');
    expect(actionIdFor('setting_set', { key: 'proxy', value: 'off' }, 'f3')).toBe('disable_proxy:f3');
  });
});

describe('compilation et exécution', () => {
  const PROC_ID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

  /** Faux Windows : le service Spooler est arrêté jusqu'à ce qu'on le démarre. */
  const machine = () => {
    let running = false;
    return new ScriptedRunner([
      {
        label: 'status',
        test: (s) => s.includes('Get-CimInstance Win32_Service'),
        reply: () => ok(JSON.stringify({ exists: true, status: running ? 'Running' : 'Stopped', startType: 'Auto' })),
      },
      {
        label: 'start',
        test: (s) => s.includes('Start-Service'),
        reply: () => {
          running = true;
          return ok('OK');
        },
      },
    ]);
  };

  it('refuse de compiler une procédure hors catalogue ou un identifiant douteux', () => {
    expect(compileProcedure(procedure({ fixes: [{ id: 'f1', tool: 'run_command', args: { cmd: 'calc' }, why: 'Lancer calc' }] }), PROC_ID).ok).toBe(false);
    expect(compileProcedure(procedure(), "x'; calc").ok).toBe(false);
  });

  it('constate, corrige avec accord, vérifie en relisant, et le client confirme', async () => {
    const compiled = compileProcedure(procedure(), PROC_ID);
    if (!compiled.ok) throw new Error(compiled.error);
    const runner = machine();
    const ui = new ScriptedConversation();
    const reporter = new Recorder();
    const outcome = await runSkill(compiled.value.skill, { runner, ui, reporter });
    expect(outcome).toEqual({ status: 'fixed', actionsDone: ['service_start:f1'] });
    expect(ui.proposed).toEqual(['service_start:f1']);
    expect(runner.count('start')).toBe(1);
    expect(runner.count('status')).toBe(2); // avant, puis relecture
    expect(ui.said).toContain("Le service d'impression est arrêté.");
    expect(reporter.events.some((e) => e.skill === `learned:${PROC_ID}` && e.type === 'action_done')).toBe(true);
  });

  it("ne propose rien quand les contrôles sont bons, et laisse le client dire si le problème persiste", async () => {
    const compiled = compileProcedure(procedure(), PROC_ID);
    if (!compiled.ok) throw new Error(compiled.error);
    const runner = new ScriptedRunner([{ label: 'status', test: (s) => s.includes('Win32_Service'), reply: () => ok(JSON.stringify({ exists: true, status: 'Running', startType: 'Auto' })) }]);
    const ui = new ScriptedConversation({ fixed: [false] });
    const outcome = await runSkill(compiled.value.skill, { runner, ui, reporter: new Recorder() });
    expect(outcome.status).toBe('escalated');
    expect(ui.proposed).toEqual([]);
    expect(runner.modifications.every((c) => c.label === 'status')).toBe(true);
  });

  it('sans contrôle objectif : applique la correction puis demande au client si c’est réglé', async () => {
    const compiled = compileProcedure(
      procedure({ checks: [], fixes: [{ id: 'f1', tool: 'explorer_restart', args: {}, why: 'Relancer le bureau qui ne répond plus' }] }),
      PROC_ID,
    );
    if (!compiled.ok) throw new Error(compiled.error);
    const runner = new ScriptedRunner([{ label: 'explorer', test: (s) => s.includes('explorer'), reply: () => ok('OK') }]);
    const ui = new ScriptedConversation();
    const outcome = await runSkill(compiled.value.skill, { runner, ui, reporter: new Recorder() });
    expect(outcome).toEqual({ status: 'fixed', actionsDone: ['explorer_restart:f1'] });
    expect(runner.count('explorer')).toBe(1);
    expect(ui.questions.at(-1)).toBe('Pouvez-vous imprimer maintenant ?');
  });

  it('une action sensible est précédée d’un point de restauration', async () => {
    const compiled = compileProcedure(
      procedure({ checks: [], fixes: [{ id: 'f1', tool: 'net_reset', args: { what: 'winsock' }, why: 'Réparer la pile réseau' }] }),
      PROC_ID,
    );
    if (!compiled.ok) throw new Error(compiled.error);
    const diagnosis = await compiled.value.skill.diagnose(new ScriptedRunner([]));
    expect(diagnosis.actions).toHaveLength(1);
    expect(diagnosis.actions[0]).toMatchObject({ risk: 'sensitive', needsReboot: true, requiresAdmin: true });
    expect(diagnosis.actions[0]!.prepare?.id).toBe('restore_point');
  });

  it('un problème constaté sans remède passe la main', async () => {
    const compiled = compileProcedure(procedure({ fixes: [], advice: ['Redémarrez le routeur.'] }), PROC_ID);
    if (!compiled.ok) throw new Error(compiled.error);
    const stopped = new ScriptedRunner([{ label: 'status', test: () => true, reply: () => ok(JSON.stringify({ exists: true, status: 'Stopped', startType: 'Manual' })) }]);
    const d = await compiled.value.skill.diagnose(stopped);
    expect(d.healthy).toBe(false);
    expect(d.needsHuman).toBe(false); // un conseil existe
    expect(d.advice).toEqual(['Redémarrez le routeur.']);
  });

  it('une lecture qui échoue ne déclenche pas de correction à l’aveugle', async () => {
    const compiled = compileProcedure(
      procedure({ fixes: [{ id: 'f1', tool: 'service_start', args: { name: 'Spooler' }, why: 'Démarrer le service', onlyIf: ['c1'] }] }),
      PROC_ID,
    );
    if (!compiled.ok) throw new Error(compiled.error);
    const broken = new ScriptedRunner([{ label: 'status', test: () => true, reply: () => fail('accès refusé') }]);
    const d = await compiled.value.skill.diagnose(broken);
    // Aucun contrôle lisible : on bascule sur « corriger puis demander au client », jamais une conclusion tirée d'un contrôle illisible.
    expect(d.problems).toEqual([]);
    expect(d.summary).toContain('Le service d\'impression est arrêté');
  });

  it('un service protégé ne peut pas être redémarré même si la procédure vient du serveur', () => {
    const compiled = compileProcedure(procedure({ fixes: [{ id: 'f1', tool: 'service_restart', args: { name: 'mpssvc' }, why: 'Relancer le pare-feu' }] }), PROC_ID);
    expect(compiled.ok).toBe(false);
  });
});

describe('typage', () => {
  it('chaque opération a un rôle et une description', () => {
    for (const tool of TOOL_IDS as ToolId[]) {
      const p = PRIMITIVES[tool];
      expect(['observe', 'act']).toContain(p.role);
      expect(p.doc.length).toBeGreaterThan(10);
    }
  });
});
