import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { COLLECT_SCRIPT, diagnoseNetwork, networkSkill, parseNetworkFacts, type NetworkFacts } from '../skills/network.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const healthy = (): NetworkFacts => ({
  adapters: [
    { name: 'Wi-Fi', description: 'Intel Wi-Fi', status: 'Up', physical: true },
    { name: 'vEthernet (WSL)', description: 'Hyper-V', status: 'Up', physical: false },
  ],
  configs: [{ alias: 'Wi-Fi', ipv4: ['192.168.1.20'], gateway: ['192.168.1.1'], dns: ['192.168.1.1'] }],
  gatewayOk: true,
  internetOk: true,
  dnsOk: true,
  httpsOk: true,
  proxy: { enabled: false, server: '', autoConfig: '' },
  admin: true,
});
const facts = (patch: Partial<NetworkFacts>): NetworkFacts => ({ ...healthy(), ...patch });

describe('diagnoseNetwork', () => {
  it('connexion saine', () => {
    expect(diagnoseNetwork(healthy())).toMatchObject({ healthy: true, actions: [], needsHuman: false });
  });

  it('carte désactivée : propose de la réactiver', () => {
    const d = diagnoseNetwork(facts({ adapters: [{ name: 'Wi-Fi', description: '', status: 'Disabled', physical: true }] }));
    expect(d.problems).toEqual(['adapter_disabled']);
    expect(d.actions.map((a) => a.id)).toEqual(['enable_adapter']);
  });

  it('nom de carte douteux : aucune action, conseil manuel', () => {
    const d = diagnoseNetwork(facts({ adapters: [{ name: "Wi-Fi'; calc #", description: '', status: 'Disabled', physical: true }] }));
    expect(d.actions).toEqual([]);
    expect(d.advice.join(' ')).toMatch(/Réactivez la carte/);
  });

  it('une carte virtuelle active ne masque pas l’absence de carte physique active', () => {
    const d = diagnoseNetwork(facts({ adapters: [{ name: 'VPN', description: '', status: 'Up', physical: false }, { name: 'Wi-Fi', description: '', status: 'Disconnected', physical: true }] }));
    expect(d.problems).toEqual(['no_link']);
    expect(d.actions).toEqual([]);
  });

  it('aucune carte : pilote, passe la main', () => {
    const d = diagnoseNetwork(facts({ adapters: [] }));
    expect(d).toMatchObject({ problems: ['no_adapter'], needsHuman: true });
  });

  it('adresse 169.254… : la box n’a pas répondu, propose de redemander une adresse', () => {
    const d = diagnoseNetwork(facts({ configs: [{ alias: 'Wi-Fi', ipv4: ['169.254.12.7'], gateway: [], dns: [] }], gatewayOk: null, internetOk: false, dnsOk: false, httpsOk: false }));
    expect(d.problems).toEqual(['dhcp_failed']);
    expect(d.actions.map((a) => a.id)).toEqual(['renew_ip']);
  });

  it('box injoignable / Internet coupé : conseils, aucune action', () => {
    expect(diagnoseNetwork(facts({ gatewayOk: false, internetOk: false })).problems).toEqual(['gateway_unreachable']);
    const noNet = diagnoseNetwork(facts({ internetOk: false, dnsOk: false, httpsOk: false }));
    expect(noNet.problems).toEqual(['no_internet']);
    expect(noNet.actions).toEqual([]);
    expect(noNet.advice.join(' ')).toMatch(/opérateur/);
  });

  it('DNS en panne : vider le cache DNS', () => {
    const d = diagnoseNetwork(facts({ dnsOk: false, httpsOk: false }));
    expect(d.problems).toEqual(['dns_failed']);
    expect(d.actions.map((a) => a.id)).toEqual(['flush_dns']);
  });

  it('https bloqué avec un proxy : propose de le désactiver en montrant son adresse ; sans proxy : conseil sur l’heure', () => {
    const proxied = diagnoseNetwork(facts({ httpsOk: false, proxy: { enabled: true, server: '10.9.9.9:8080', autoConfig: '' } }));
    expect(proxied.problems).toEqual(['proxy_blocking']);
    expect(proxied.actions[0]!.explanation).toContain('10.9.9.9:8080');
    expect(proxied.actions[0]!.requiresAdmin).toBe(false);

    const plain = diagnoseNetwork(facts({ httpsOk: false }));
    expect(plain.problems).toEqual(['https_blocked']);
    expect(plain.advice.join(' ')).toMatch(/heure/);
  });
});

describe('lecture des faits réseau', () => {
  it('accepte objets seuls, valeurs manquantes et texte parasite', () => {
    const raw = JSON.stringify({ adapters: { name: 'Ethernet', status: 'Up', physical: true }, configs: { alias: 'Ethernet', ipv4: '10.0.0.5', gateway: '10.0.0.1' }, internetOk: true, dnsOk: true, httpsOk: true, proxy: { enabled: false } });
    const parsed = parseNetworkFacts(`﻿bruit\n${raw}`);
    expect(parsed.adapters).toHaveLength(1);
    expect(parsed.configs[0]!.ipv4).toEqual(['10.0.0.5']);
    expect(parsed.gatewayOk).toBeNull();
    expect(() => parseNetworkFacts('rien')).toThrow(/illisible/);
  });
});

describe('compétence réseau de bout en bout (faux Windows)', () => {
  const servicesJson = (state: string) =>
    JSON.stringify({
      services: ['Dhcp', 'Dnscache', 'NlaSvc', 'LanmanWorkstation'].map((n) => ({ name: n, display: n, state: n === 'Dnscache' ? state : 'Running', startMode: 'Auto', dependsOn: [] })),
      admin: true,
    });

  function machine(opts: { dnsServiceState?: string; dnsOk?: boolean } = {}) {
    const state = { dnsServiceState: opts.dnsServiceState ?? 'Running', dnsOk: opts.dnsOk ?? true };
    const runner = new ScriptedRunner([
      { label: 'collect-services', test: (s) => s.includes('Win32_Service'), reply: () => ok(servicesJson(state.dnsServiceState)) },
      { label: 'collect-network', test: (s) => s.includes('Get-NetAdapter') && s.includes('Resolve-DnsName'), reply: () => ok(JSON.stringify({ ...healthy(), dnsOk: state.dnsOk, httpsOk: state.dnsOk })) },
      { label: 'flush', test: (s) => s.includes('Clear-DnsClientCache'), reply: () => { state.dnsOk = true; return ok(); } },
      { label: 'start', test: (s) => s.includes("Start-Service -Name 'Dnscache'"), reply: () => { state.dnsServiceState = 'Running'; return ok(); } },
    ]);
    return { runner, state };
  }

  it('DNS en panne : vide le cache après accord, vérifie, le client confirme', async () => {
    const { runner } = machine({ dnsOk: false });
    const ui = new ScriptedConversation();
    const out = await runSkill(networkSkill(), { runner, ui, reporter: new Recorder() });
    expect(out).toEqual({ status: 'fixed', actionsDone: ['flush_dns'] });
    expect(ui.questions).toEqual(['Avez-vous de nouveau accès à Internet ?']);
  });

  it('un service réseau arrêté est traité AVANT le reste : le test de connexion n’est même pas lancé', async () => {
    const { runner } = machine({ dnsServiceState: 'Stopped' });
    const ui = new ScriptedConversation();
    const out = await runSkill(networkSkill(), { runner, ui, reporter: new Recorder() });
    expect(ui.proposed[0]).toBe('start_service:Dnscache');
    expect(out.status).toBe('fixed');
    // le test de connexion n'a eu lieu qu'après la réparation du service
    expect(runner.calls.findIndex((c) => c.label === 'collect-network')).toBeGreaterThan(runner.calls.findIndex((c) => c.label === 'start'));
  });
});

describe('script de collecte réseau', () => {
  it('est bien formé et ne modifie rien', () => {
    checkStructure(COLLECT_SCRIPT);
    expect(COLLECT_SCRIPT).not.toMatch(/Set-|Start-|Stop-|Remove-|Enable-|Disable-|Clear-|New-Item|Restart-/);
  });
});
