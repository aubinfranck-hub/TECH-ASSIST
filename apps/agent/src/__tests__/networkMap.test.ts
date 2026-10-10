import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { routeIntent } from '../router.js';
import { resolveSkill } from '../skills/index.js';
import { COLLECT_SCRIPT, diagnoseNetworkMap, networkMapSkill, parseNetworkMapFacts } from '../skills/networkMap.js';
import { Recorder, ScriptedConversation } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const out = (o: unknown) => JSON.stringify(o);

describe('carte du réseau local — lecture', () => {
  it('garde les appareils valides, trie par adresse et retire diffusion, multidiffusion et doublons', () => {
    const facts = parseNetworkMapFacts(
      out({
        gateway: '192.168.1.1',
        gatewayReachable: true,
        neighbors: [
          { ip: '192.168.1.20', mac: 'aa-bb-cc-dd-ee-02' },
          { ip: '192.168.1.1', mac: 'AA-BB-CC-DD-EE-01' },
          { ip: '192.168.1.255', mac: 'FF-FF-FF-FF-FF-FF' },
          { ip: '224.0.0.22', mac: '01-00-5E-00-00-16' },
          { ip: '169.254.3.4', mac: 'AA-BB-CC-DD-EE-09' },
          { ip: '192.168.1.20', mac: 'AA-BB-CC-DD-EE-02' },
          { ip: '192.168.1.99', mac: '00-00-00-00-00-00' },
          { ip: '999.1.1.1', mac: 'AA-BB-CC-DD-EE-03' },
          { ip: '192.168.1.5', mac: 'pas-une-mac' },
        ],
      }),
    );
    expect(facts.neighbors.map((n) => n.ip)).toEqual(['192.168.1.1', '192.168.1.20']);
    expect(facts.neighbors[1]!.mac).toBe('AA:BB:CC:DD:EE:02');
  });

  it('tolère un voisin unique (objet au lieu d\'un tableau), des champs absents et du texte parasite', () => {
    const f = parseNetworkMapFacts(`bruit\n${out({ gateway: '10.0.0.1', neighbors: { ip: '10.0.0.7', mac: 'AA-BB-CC-DD-EE-07' } })}`);
    expect(f.neighbors).toHaveLength(1);
    expect(f.gatewayReachable).toBeNull();
    expect(parseNetworkMapFacts(out({})).gateway).toBeNull();
  });

  it('rejette une passerelle qui n\'est pas une adresse IPv4', () => {
    expect(parseNetworkMapFacts(out({ gateway: '1.1.1.1; rm -rf', neighbors: [] })).gateway).toBeNull();
    expect(parseNetworkMapFacts(out({ gateway: '0.0.0.0', neighbors: [] })).gateway).toBeNull();
  });

  it('refuse un résultat illisible', () => {
    expect(() => parseNetworkMapFacts('rien')).toThrow();
  });
});

describe('carte du réseau local — diagnostic', () => {
  const base = { gateway: '192.168.1.1', gatewayReachable: true, neighbors: [{ ip: '192.168.1.1', mac: 'AA:BB:CC:DD:EE:01' }, { ip: '192.168.1.20', mac: 'AA:BB:CC:DD:EE:02' }] };

  it('réseau sain : liste la passerelle et les appareils, avec les limites', () => {
    const d = diagnoseNetworkMap(base);
    expect(d.healthy).toBe(true);
    expect(d.summary).toContain('1 autre(s) appareil(s)');
    const text = d.advice.join('\n');
    expect(text).toContain('192.168.1.1 — passerelle');
    expect(text).toContain('192.168.1.20 — appareil');
    expect(text).toContain('pas de balayage');
    expect(d.actions).toEqual([]);
  });

  it('passerelle muette : conseille de redémarrer la box', () => {
    const d = diagnoseNetworkMap({ ...base, gatewayReachable: false });
    expect(d.healthy).toBe(false);
    expect(d.problems).toContain('gateway_unreachable');
    expect(d.advice[0]).toContain('Redémarrez la box');
  });

  it('aucun réseau : le dit clairement', () => {
    const d = diagnoseNetworkMap({ gateway: null, gatewayReachable: null, neighbors: [] });
    expect(d.healthy).toBe(false);
    expect(d.problems).toContain('no_gateway');
  });

  it('plafonne la liste affichée', () => {
    const neighbors = Array.from({ length: 40 }, (_, i) => ({ ip: `192.168.1.${i + 2}`, mac: 'AA:BB:CC:DD:EE:FF' }));
    const d = diagnoseNetworkMap({ gateway: '192.168.1.1', gatewayReachable: true, neighbors });
    expect(d.advice.join('\n')).toContain('et 20 autre(s)');
  });
});

describe('carte du réseau local — sécurité et intégration', () => {
  it('la collecte est en lecture seule, sans balayage ni connexion', () => {
    checkStructure(COLLECT_SCRIPT);
    expect(COLLECT_SCRIPT).not.toMatch(/\b(Set|Start|Stop|Remove|Enable|Disable|Clear|New|Restart|Update|Invoke|Add)-[A-Za-z]/);
    expect(COLLECT_SCRIPT).not.toMatch(/Test-NetConnection|Resolve-DnsName|nmap|Get-Credential|ssh|Enter-PSSession/i);
    // Seule émission réseau : un ping vers la passerelle déjà configurée sur ce PC.
    expect(COLLECT_SCRIPT.match(/Test-Connection/g)).toHaveLength(1);
  });

  it('bout en bout : n\'agit sur rien et rend un rapport', async () => {
    const runner = { runPowerShell: async () => ({ stdout: out({ gateway: '192.168.1.1', gatewayReachable: true, neighbors: [{ ip: '192.168.1.20', mac: 'AA-BB-CC-DD-EE-02' }] }), stderr: '', exitCode: 0 }) };
    const ui = new ScriptedConversation();
    const rec = new Recorder();
    const outcome = await runSkill(networkMapSkill(), { runner, ui, reporter: rec });
    expect(outcome.status).toBe('fixed'); // rapport d'information : rien n'est modifié
    expect(ui.proposed).toEqual([]);
  });

  it('est disponible dans le menu et par identifiant', () => {
    expect(resolveSkill('lan-map')?.id).toBe('lan-map');
  });

  it('se déclenche sur les demandes de carte du réseau, sans doubler avec « Internet / Wi-Fi »', () => {
    for (const msg of ['Qui est connecté sur mon réseau ?', 'Montre-moi les appareils connectés', 'fais une cartographie du réseau', 'qui utilise mon wifi']) {
      const skills = routeIntent(msg).filter((i) => i.kind === 'skill').map((i) => (i as { skillId: string }).skillId);
      expect(skills, msg).toEqual(['lan-map']);
    }
    const net = routeIntent('je nai plus internet').filter((i) => i.kind === 'skill').map((i) => (i as { skillId: string }).skillId);
    expect(net).toEqual(['network']);
  });
});
