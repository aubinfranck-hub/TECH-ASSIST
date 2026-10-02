import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { diagnoseNetwork, formatChain, networkChain, networkSkill, type NetworkFacts } from '../skills/network.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const healthy = (): NetworkFacts => ({
  adapters: [{ name: 'Wi-Fi', description: 'Intel Wi-Fi', status: 'Up', physical: true }],
  configs: [{ alias: 'Wi-Fi', ipv4: ['192.168.1.20'], gateway: ['192.168.1.1'], dns: ['192.168.1.1'] }],
  gatewayOk: true,
  internetOk: true,
  dnsOk: true,
  httpsOk: true,
  proxy: { enabled: false, server: '', autoConfig: '' },
  admin: true,
});
const facts = (patch: Partial<NetworkFacts>): NetworkFacts => ({ ...healthy(), ...patch });

describe('tableau des maillons réseau', () => {
  it('tout vert', () => {
    expect(networkChain(healthy()).every((l) => l.ok === true)).toBe(true);
  });

  it('DNS rouge : Internet vert, https non testé', () => {
    const chain = networkChain(facts({ dnsOk: false, httpsOk: false }));
    expect(chain.map((l) => l.ok)).toEqual([true, true, true, true, false, null]);
    const text = formatChain(chain);
    expect(text).toContain('🟢');
    expect(text).toMatch(/DNS \(noms de sites\)\s+🔴/);
    expect(text).toMatch(/Sites sécurisés \(https\)\s+⚪ non testé/);
  });

  it('pas de carte : tout le reste est non testé', () => {
    const chain = networkChain(facts({ adapters: [] }));
    expect(chain[0]!.ok).toBe(false);
    expect(chain.slice(1).every((l) => l.ok === null)).toBe(true);
  });

  it('le diagnostic affiche le tableau', () => {
    expect(diagnoseNetwork(facts({ dnsOk: false })).summary).toMatch(/Carte réseau\s+🟢/);
  });
});

describe('enchaînement d’hypothèses', () => {
  it('DNS : vider le cache, puis DNS automatiques, puis pile réseau (jamais tout d’un coup)', () => {
    const f = facts({ dnsOk: false });
    expect(diagnoseNetwork(f).actions.map((a) => a.id)).toEqual(['flush_dns']);
    expect(diagnoseNetwork(f, new Set(['flush_dns'])).actions.map((a) => a.id)).toEqual(['flush_dns', 'reset_dns_servers']);
    expect(diagnoseNetwork(f, new Set(['flush_dns', 'reset_dns_servers'])).actions.map((a) => a.id)).toEqual(['flush_dns', 'reset_dns_servers', 'reset_network_stack']);
  });

  it('box injoignable : redémarrer la carte, puis la pile réseau', () => {
    const f = facts({ gatewayOk: false, internetOk: false, dnsOk: false, httpsOk: false });
    expect(diagnoseNetwork(f).actions.map((a) => a.id)).toEqual(['restart_adapter']);
    expect(diagnoseNetwork(f, new Set(['restart_adapter'])).actions.map((a) => a.id)).toEqual(['restart_adapter', 'reset_network_stack']);
  });

  it('la réinitialisation de la pile est sensible, avec point de restauration et redémarrage', () => {
    const stack = diagnoseNetwork(facts({ dnsOk: false }), new Set(['reset_dns_servers'])).actions.find((a) => a.id === 'reset_network_stack')!;
    expect(stack.risk).toBe('sensitive');
    expect(stack.prepare?.id).toBe('restore_point');
    expect(stack.needsReboot).toBe(true);
  });

  it('de bout en bout : le cache DNS ne suffit pas → DNS automatiques → réglé', async () => {
    const state = { reset: false };
    const services = JSON.stringify({ services: ['Dhcp', 'Dnscache', 'NlaSvc', 'LanmanWorkstation'].map((n) => ({ name: n, display: n, state: 'Running', startMode: 'Auto', dependsOn: [] })), admin: true });
    const runner = new ScriptedRunner([
      { label: 'collect-services', test: (s) => s.includes('Win32_Service'), reply: () => ok(services) },
      { label: 'collect-network', test: (s) => s.includes('Get-NetAdapter') && s.includes('Resolve-DnsName'), reply: () => ok(JSON.stringify({ ...healthy(), dnsOk: state.reset, httpsOk: state.reset })) },
      { label: 'reset-dns', test: (s) => s.includes('-ResetServerAddresses'), reply: () => { state.reset = true; return ok(); } },
      { label: 'flush', test: (s) => s.includes('Clear-DnsClientCache'), reply: () => ok() },
    ]);
    const ui = new ScriptedConversation();
    const out = await runSkill(networkSkill(), { runner, ui, reporter: new Recorder() });
    expect(ui.proposed).toEqual(['flush_dns', 'reset_dns_servers']);
    expect(out).toEqual({ status: 'fixed', actionsDone: ['flush_dns', 'reset_dns_servers'] });
    for (const c of runner.calls.filter((c) => !c.label.startsWith('collect'))) checkStructure(c.script);
  });

  it('un nom de carte douteux n’entre jamais dans un script', () => {
    const d = diagnoseNetwork(facts({ adapters: [{ name: "Wi-Fi'; calc #", description: '', status: 'Up', physical: true }], configs: [{ alias: "Wi-Fi'; calc #", ipv4: ['10.0.0.2'], gateway: ['10.0.0.1'], dns: [] }], gatewayOk: false }));
    expect(d.actions.map((a) => a.id)).not.toContain('restart_adapter');
  });
});
