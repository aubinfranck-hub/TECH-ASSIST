import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { SKILL_MENU, resolveSkill } from '../skills/index.js';
import {
  PROFILES,
  collectScript,
  customServiceSkill,
  diagnoseServices,
  parseServiceFacts,
  serviceSkill,
  windowsHealthSkill,
} from '../skills/services.js';
import { FakeServices, servicesState, svcRec } from './fakeServices.js';
import { RecordingReporter, ScriptedUi } from './fakeMachine.js';
import { checkStructure } from './structure.js';

function go(skillFactory: () => ReturnType<typeof serviceSkill>, machine: FakeServices, ui: ConstructorParameters<typeof ScriptedUi>[0] = {}) {
  const reporter = new RecordingReporter();
  const screen = new ScriptedUi(ui);
  return { reporter, screen, run: () => runSkill(skillFactory(), { runner: machine, ui: screen, reporter }) };
}

describe('lecture des faits', () => {
  it('lit une sortie normale, un objet seul et un BOM', () => {
    const one = JSON.stringify({ services: { name: 'Spooler', display: 'Spouleur', state: 'Running', startMode: 'Auto', dependsOn: 'RPCSS' }, spoolFiles: 3, spoolOldestMinutes: 25, admin: true });
    const facts = parseServiceFacts(`﻿${one}`);
    expect(facts.services).toEqual([{ name: 'Spooler', display: 'Spouleur', state: 'Running', startMode: 'Auto', dependsOn: ['RPCSS'] }]);
    expect(facts.spoolFiles).toBe(3);
  });

  it('refuse une sortie illisible et écarte les noms de service douteux', () => {
    expect(() => parseServiceFacts('rien')).toThrow(/illisible/);
    const evil = JSON.stringify({
      services: [
        { name: "Spooler'; calc #", state: 'Running' },
        { name: 'Dhcp', state: 'Running', dependsOn: ["x'; calc", 'Afd'] },
      ],
    });
    const facts = parseServiceFacts(evil);
    expect(facts.services.map((s) => s.name)).toEqual(['Dhcp']);
    expect(facts.services[0]!.dependsOn).toEqual(['Afd']);
  });
});

describe('diagnostic : services arrêtés ou désactivés', () => {
  const print = PROFILES.print!.services;

  it('tout va bien : sain', () => {
    const d = diagnoseServices(print, servicesState([svcRec('Spooler', 'Running')]));
    expect(d).toMatchObject({ healthy: true, needsHuman: false, actions: [] });
  });

  it('service arrêté : propose de le démarrer', () => {
    const d = diagnoseServices(print, servicesState([svcRec('Spooler', 'Stopped', 'Auto', [], "Spouleur d'impression")]));
    expect(d.problems).toEqual(['service_stopped:Spooler']);
    expect(d.actions.map((a) => a.id)).toEqual(['start_service:Spooler']);
    expect(d.summary).toContain("Spouleur d'impression");
  });

  it('service désactivé : le remet en démarrage automatique ET le démarre, en une seule action', () => {
    const d = diagnoseServices(print, servicesState([svcRec('Spooler', 'Stopped', 'Disabled')]));
    expect(d.problems).toEqual(['service_disabled:Spooler']);
    expect(d.actions.map((a) => a.id)).toEqual(['enable_service:Spooler']);
    expect(d.actions[0]!.explanation).toMatch(/volontairement/);
  });

  it('service « à la demande » arrêté : normal, pas de fausse alerte', () => {
    const d = diagnoseServices(PROFILES.update!.services, servicesState([svcRec('wuauserv', 'Stopped', 'Manual'), svcRec('BITS', 'Stopped', 'Manual'), svcRec('CryptSvc', 'Running')]));
    expect(d.healthy).toBe(true);
  });

  it('service « à la demande » désactivé : réactivé en manuel, sans le démarrer', async () => {
    const machine = new FakeServices(servicesState([svcRec('wuauserv', 'Stopped', 'Disabled'), svcRec('BITS', 'Stopped', 'Manual'), svcRec('CryptSvc', 'Running')]));
    const d = diagnoseServices(PROFILES.update!.services, machine.state);
    expect(d.actions.map((a) => a.id)).toEqual(['enable_service:wuauserv']);
    await d.actions[0]!.run(machine);
    expect(machine.state.services[0]).toMatchObject({ startMode: 'Manual', state: 'Stopped' });
  });

  it('service obligatoire introuvable : passe la main ; composant facultatif absent : ignoré', () => {
    const missing = diagnoseServices(print, servicesState([]));
    expect(missing.needsHuman).toBe(true);
    expect(missing.problems).toEqual(['service_missing:Spooler']);

    const optional = diagnoseServices(
      PROFILES.network!.services,
      servicesState(['Dhcp', 'Dnscache', 'NlaSvc', 'LanmanWorkstation'].map((n) => svcRec(n, 'Running'))), // pas de WlanSvc : PC de bureau
    );
    expect(optional.healthy).toBe(true);
  });

  it('service en cours de démarrage : conseil de patienter, aucune action', () => {
    const d = diagnoseServices(print, servicesState([svcRec('Spooler', 'Start Pending')]));
    expect(d.problems).toEqual(['service_pending:Spooler']);
    expect(d.actions).toEqual([]);
    expect(d.advice.join(' ')).toMatch(/Patientez/);
  });

  it('prévient quand l’agent n’est pas administrateur', () => {
    const d = diagnoseServices(print, servicesState([svcRec('Spooler', 'Stopped')], { admin: false }));
    expect(d.advice.join(' ')).toMatch(/administrateur/);
  });
});

describe('dépendances', () => {
  const custom = [{ name: 'Mon', label: 'Mon', mustRun: true, required: true, startup: 'Manual' as const }];

  it('démarre d’abord ce dont le service dépend, puis le service', () => {
    const d = diagnoseServices(
      custom,
      servicesState([svcRec('Mon', 'Stopped', 'Auto', ['Base']), svcRec('Base', 'Stopped', 'Manual', ['Racine']), svcRec('Racine', 'Stopped', 'Manual')]),
      { custom: true },
    );
    expect(d.actions.map((a) => a.id)).toEqual(['start_service:Racine', 'start_service:Base', 'start_service:Mon']);
  });

  it('une dépendance désactivée est réactivée avant le service', () => {
    const d = diagnoseServices(
      custom,
      servicesState([svcRec('Mon', 'Stopped', 'Auto', ['Base']), svcRec('Base', 'Stopped', 'Disabled')]),
      { custom: true },
    );
    expect(d.actions.map((a) => a.id)).toEqual(['enable_service:Base', 'start_service:Mon']);
  });

  it('une dépendance déjà en marche n’ajoute rien ; un cycle ne boucle pas', () => {
    const ok = diagnoseServices(custom, servicesState([svcRec('Mon', 'Stopped', 'Auto', ['Base']), svcRec('Base', 'Running')]), { custom: true });
    expect(ok.actions.map((a) => a.id)).toEqual(['start_service:Mon']);

    const cycle = diagnoseServices(custom, servicesState([svcRec('Mon', 'Stopped', 'Auto', ['Base']), svcRec('Base', 'Stopped', 'Auto', ['Mon'])]), { custom: true });
    expect(cycle.actions.length).toBeLessThanOrEqual(2);
  });
});

describe('sécurité', () => {
  it('ne réactive jamais un service sensible désactivé (probablement exprès) : passe la main', () => {
    const skill = customServiceSkill('RemoteRegistry');
    const d = diagnoseServices(
      [{ name: 'RemoteRegistry', label: 'x', mustRun: true, required: true, startup: 'Manual' }],
      servicesState([svcRec('RemoteRegistry', 'Stopped', 'Disabled')]),
      { custom: true },
    );
    expect(skill.id).toBe('service:RemoteRegistry');
    expect(d.needsHuman).toBe(true);
    expect(d.actions).toEqual([]);
  });

  it('un service sensible désactivé en dépendance n’est pas réactivé non plus', () => {
    const d = diagnoseServices(
      [{ name: 'Mon', label: 'Mon', mustRun: true, required: true, startup: 'Manual' }],
      servicesState([svcRec('Mon', 'Stopped', 'Auto', ['WinRM']), svcRec('WinRM', 'Stopped', 'Disabled')]),
      { custom: true },
    );
    expect(d.needsHuman).toBe(true);
    expect(d.actions.map((a) => a.id)).not.toContain('enable_service:WinRM');
  });

  it('refuse un nom de service qui pourrait injecter du PowerShell', () => {
    for (const bad of ["x'; calc #", 'a b', '$(calc)', '', 'a'.repeat(41), 'x`y', 'x;y']) {
      expect(() => customServiceSkill(bad)).toThrow(/invalide/);
      expect(resolveSkill(`service:${bad}`)).toBeUndefined();
    }
  });

  it('les noms de service n’entrent dans un script que s’ils sont valides', () => {
    expect(() => collectScript(["Spooler','x"], false)).toThrow(/invalide/);
  });
});

describe('file d’impression bloquée', () => {
  const spoolerOk = svcRec('Spooler', 'Running');

  it('des documents en attente depuis longtemps : propose de vider la file', () => {
    const d = diagnoseServices(PROFILES.print!.services, servicesState([spoolerOk], { spoolFiles: 4, spoolOldestMinutes: 45 }));
    expect(d.problems).toEqual(['print_queue_stuck']);
    expect(d.actions[0]!.id).toBe('clear_print_queue');
    expect(d.actions[0]!.explanation).toMatch(/ne seront pas imprimés/);
  });

  it('des documents récents (impression en cours) ne sont pas touchés', () => {
    const d = diagnoseServices(PROFILES.print!.services, servicesState([spoolerOk], { spoolFiles: 2, spoolOldestMinutes: 1 }));
    expect(d.healthy).toBe(true);
  });

  it('file pleine mais demande hors impression : on n\'y touche pas', () => {
    const d = diagnoseServices(PROFILES.search!.services, servicesState([svcRec('WSearch', 'Running')], { spoolFiles: 9, spoolOldestMinutes: 500 }));
    expect(d.healthy).toBe(true);
  });

  it('file non vérifiée (autre domaine) : aucune proposition', () => {
    const d = diagnoseServices(PROFILES.search!.services, servicesState([svcRec('WSearch', 'Running')], { spoolFiles: null }));
    expect(d.healthy).toBe(true);
  });

  it('spouleur arrêté ET file pleine : on démarre d’abord le spouleur, sans proposer le vidage tout de suite', () => {
    const d = diagnoseServices(PROFILES.print!.services, servicesState([svcRec('Spooler', 'Stopped')], { spoolFiles: 4, spoolOldestMinutes: 45 }));
    expect(d.actions.map((a) => a.id)).toEqual(['start_service:Spooler']);
  });
});

describe("l'agent sur les services (de bout en bout, faux Windows)", () => {
  it("impression : spouleur arrêté → démarré avec l'accord du client → « Pouvez-vous imprimer ? » → réglé", async () => {
    const machine = new FakeServices(servicesState([svcRec('Spooler', 'Stopped')]));
    const t = go(() => serviceSkill('print'), machine);
    expect(await t.run()).toEqual({ status: 'fixed', actionsDone: ['start_service:Spooler'] });
    expect(machine.state.services[0]!.state).toBe('Running');
    expect(t.screen.questions).toEqual(['Pouvez-vous imprimer maintenant ?']);
    expect(t.reporter.types).toEqual(['diagnosed', 'action_proposed', 'action_approved', 'action_done', 'verified']);
  });

  it('rien ne change avant le oui ; un refus ne modifie rien', async () => {
    const machine = new FakeServices(servicesState([svcRec('Spooler', 'Stopped')]));
    const t = go(() => serviceSkill('print'), machine, { approve: { 'start_service:Spooler': false } });
    expect((await t.run()).status).toBe('declined');
    expect(machine.modifications).toHaveLength(0);
  });

  it('file bloquée : vidée après accord, puis réglé', async () => {
    const machine = new FakeServices(servicesState([svcRec('Spooler', 'Running')], { spoolFiles: 5, spoolOldestMinutes: 120 }));
    const t = go(() => serviceSkill('print'), machine);
    expect(await t.run()).toEqual({ status: 'fixed', actionsDone: ['clear_print_queue'] });
    expect(machine.state.spoolFiles).toBe(0);
  });

  it('un service qui refuse de démarrer : échec dit clairement, passage de main', async () => {
    const machine = new FakeServices(servicesState([svcRec('Spooler', 'Stopped')]), { failStart: { Spooler: 'Accès refusé' } });
    const t = go(() => serviceSkill('print'), machine);
    const outcome = await t.run();
    expect(outcome).toMatchObject({ status: 'escalated', recorded: true });
    expect(t.reporter.types).toEqual(['diagnosed', 'action_proposed', 'action_approved', 'action_failed', 'escalated']);
  });

  it('action sans effet réel : la relecture le voit et passe la main', async () => {
    const machine = new FakeServices(servicesState([svcRec('Spooler', 'Stopped')]), { noEffect: true });
    const t = go(() => serviceSkill('print'), machine);
    expect((await t.run()).status).toBe('escalated');
    expect(machine.modifications).toHaveLength(1); // pas d'insistance
  });

  it('service précis par son nom, avec ses dépendances', async () => {
    const machine = new FakeServices(servicesState([svcRec('MonService', 'Stopped', 'Auto', ['Base']), svcRec('Base', 'Stopped', 'Manual')]));
    const t = go(() => customServiceSkill('MonService'), machine);
    expect(await t.run()).toEqual({ status: 'fixed', actionsDone: ['start_service:Base', 'start_service:MonService'] });
    expect(t.screen.questions).toEqual(['Le service « MonService » fonctionne-t-il maintenant ?']);
  });

  it('service précis introuvable : passage de main sans rien tenter', async () => {
    const machine = new FakeServices(servicesState([]));
    const t = go(() => customServiceSkill('Fantome'), machine);
    expect((await t.run()).status).toBe('escalated');
    expect(machine.modifications).toHaveLength(0);
  });

  it('analyse complète : plusieurs problèmes dans des domaines différents, chacun proposé séparément', async () => {
    const machine = new FakeServices(
      servicesState([
        svcRec('Spooler', 'Stopped'),
        svcRec('Dhcp', 'Running'),
        svcRec('Dnscache', 'Stopped'),
        svcRec('NlaSvc', 'Running'),
        svcRec('LanmanWorkstation', 'Running'),
        svcRec('CryptSvc', 'Running'),
        svcRec('wuauserv', 'Stopped', 'Disabled'),
        svcRec('BITS', 'Stopped', 'Manual'),
        svcRec('WSearch', 'Running'),
        svcRec('W32Time', 'Stopped', 'Manual'),
        svcRec('EventLog', 'Running'),
        svcRec('Winmgmt', 'Running'),
        svcRec('Schedule', 'Running'),
        svcRec('PlugPlay', 'Running'),
        svcRec('Themes', 'Running'),
        svcRec('AudioEndpointBuilder', 'Running'),
        svcRec('Audiosrv', 'Running'),
      ]),
    );
    const t = go(windowsHealthSkill, machine, { approve: { 'enable_service:wuauserv': false } });
    const outcome = await t.run();
    expect(t.screen.proposed.sort()).toEqual(['enable_service:wuauserv', 'start_service:Dnscache', 'start_service:Spooler']);
    expect(machine.state.services.find((s) => s.name === 'wuauserv')!.startMode).toBe('Disabled'); // refusé : intact
    expect(machine.state.services.find((s) => s.name === 'Spooler')!.state).toBe('Running');
    expect(outcome.status).toBe('escalated'); // il reste le service refusé : l'agent le dit et passe la main
  });
});

describe('menu et résolution des compétences', () => {
  it('chaque entrée du menu produit une compétence valide, avec sa question de vérification', () => {
    expect(SKILL_MENU.length).toBeGreaterThanOrEqual(8);
    for (const choice of SKILL_MENU) {
      const skill = choice.build();
      expect(skill.verifyQuestion).toMatch(/\?$/);
      expect(resolveSkill(choice.id)?.id).toBe(skill.id);
    }
  });

  it('résout un service précis et rejette l’inconnu', () => {
    expect(resolveSkill('service:Spooler')?.id).toBe('service:Spooler');
    expect(resolveSkill('nimportequoi')).toBeUndefined();
  });
});

describe('scripts PowerShell (contrôle de structure : pas de PowerShell dans cet environnement)', () => {
  it('le script de collecte est bien formé et en lecture seule', () => {
    for (const withSpool of [false, true]) {
      const script = collectScript(['Spooler', 'Dhcp'], withSpool);
      checkStructure(script);
      expect(script).not.toMatch(/Set-|Start-|Stop-|Remove-|New-Item|Restart-/);
    }
  });

  it('chaque script d’action est bien formé', async () => {
    const machine = new FakeServices(
      servicesState([svcRec('A', 'Stopped'), svcRec('B', 'Stopped', 'Disabled'), svcRec('Spooler', 'Running')], { spoolFiles: 3, spoolOldestMinutes: 60 }),
    );
    const start = diagnoseServices([{ name: 'A', label: 'A', mustRun: true, required: true, startup: 'Manual' }], machine.state);
    const enable = diagnoseServices([{ name: 'B', label: 'B', mustRun: true, required: true, startup: 'Automatic' }], machine.state);
    const queue = diagnoseServices(PROFILES.print!.services, machine.state);
    for (const action of [...start.actions, ...enable.actions, ...queue.actions]) await action.run(machine);
    expect(machine.modifications.map((c) => c.kind).sort()).toEqual(['clear_queue', 'enable', 'start']);
    for (const call of machine.modifications) checkStructure(call.script);
  });

  it('aucune action n’arrête ni ne désactive un service', async () => {
    const machine = new FakeServices(servicesState([svcRec('A', 'Stopped'), svcRec('B', 'Stopped', 'Disabled')]));
    const d = diagnoseServices(
      [
        { name: 'A', label: 'A', mustRun: true, required: true, startup: 'Manual' },
        { name: 'B', label: 'B', mustRun: true, required: true, startup: 'Manual' },
      ],
      machine.state,
    );
    for (const action of d.actions) await action.run(machine);
    for (const call of machine.modifications) {
      expect(call.script).not.toMatch(/-StartupType Disabled/);
      expect(call.script).not.toMatch(/Stop-Service/);
    }
  });
});
