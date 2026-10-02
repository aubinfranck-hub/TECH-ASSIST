import type { Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, readScript } from './common.js';

/**
 * Carte du réseau local vue depuis ce PC : passerelle (la box ou le routeur) et appareils déjà « vus »
 * par Windows (table des voisins). 100 % passif et en lecture seule : aucun balayage du réseau,
 * aucune connexion à un autre appareil, aucun identifiant demandé.
 */

export interface Neighbor {
  ip: string;
  mac: string;
}

export interface NetworkMapFacts {
  gateway: string | null;
  gatewayReachable: boolean | null;
  neighbors: Neighbor[];
}

/**
 * États de voisinage de Windows (valeurs numériques, pas de texte localisé) :
 * 0 Unreachable, 1 Incomplete, 2 Probe, 3 Delay, 4 Stale, 5 Reachable, 6 Permanent.
 * On garde ce qui a répondu (2 à 5) ; les entrées « 0/1/6 » ne sont pas des appareils vus.
 */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
$gw = [string]$route.NextHop
$reach = $null
if ($gw -match '^[0-9.]+$') { $reach = [bool](Test-Connection -ComputerName $gw -Count 1 -Quiet) }
$n = @(Get-NetNeighbor -AddressFamily IPv4 | Where-Object { [int]$_.State -ge 2 -and [int]$_.State -le 5 } | ForEach-Object { [pscustomobject]@{ ip = [string]$_.IPAddress; mac = [string]$_.LinkLayerAddress } })
[pscustomobject]@{ gateway = $gw; gatewayReachable = $reach; neighbors = $n } | ConvertTo-Json -Depth 3 -Compress
`);

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const MAC = /^[0-9A-Fa-f]{2}([-:][0-9A-Fa-f]{2}){5}$/;

function isDeviceIp(ip: string): boolean {
  const first = Number(ip.split('.')[0]);
  if (first >= 224) return false; // multidiffusion et diffusion
  if (ip.endsWith('.255') || ip.startsWith('127.') || ip.startsWith('169.254.') || ip === '0.0.0.0') return false;
  return true;
}

export function parseNetworkMapFacts(stdout: string): NetworkMapFacts {
  const raw = extractJson(stdout);
  const gateway = typeof raw.gateway === 'string' && IPV4.test(raw.gateway) && raw.gateway !== '0.0.0.0' ? raw.gateway : null;
  const seen = new Set<string>();
  const neighbors: Neighbor[] = [];
  for (const item of asArray<Record<string, unknown>>(raw.neighbors)) {
    const ip = typeof item.ip === 'string' ? item.ip : '';
    const mac = typeof item.mac === 'string' ? item.mac.toUpperCase().replaceAll('-', ':') : '';
    if (!IPV4.test(ip) || !MAC.test(mac.replaceAll(':', '-')) || !isDeviceIp(ip) || /^(00:00:00:00:00:00|FF:FF:FF:FF:FF:FF)$/.test(mac)) continue;
    if (seen.has(ip)) continue;
    seen.add(ip);
    neighbors.push({ ip, mac });
  }
  neighbors.sort((a, b) => a.ip.split('.').map(Number).reduce((x, y) => x * 256 + y, 0) - b.ip.split('.').map(Number).reduce((x, y) => x * 256 + y, 0));
  return { gateway, gatewayReachable: typeof raw.gatewayReachable === 'boolean' ? raw.gatewayReachable : null, neighbors };
}

const MAX_LISTED = 20;

export function diagnoseNetworkMap(facts: NetworkMapFacts): Diagnosis {
  const advice: string[] = [];
  const problems: string[] = [];

  if (!facts.gateway) {
    return {
      summary: "Cet ordinateur n'est relié à aucun réseau (pas de passerelle trouvée).",
      problems: ['no_gateway'],
      actions: [],
      advice: ['Vérifiez le câble réseau ou la connexion Wi-Fi, ou demandez-moi de diagnostiquer « Internet / Wi-Fi ».'],
      healthy: false,
      needsHuman: false,
    };
  }

  const others = facts.neighbors.filter((n) => n.ip !== facts.gateway);
  const gatewayEntry = facts.neighbors.find((n) => n.ip === facts.gateway);
  const lines = [
    `${facts.gateway} — passerelle (box ou routeur)${gatewayEntry ? ` · ${gatewayEntry.mac}` : ''}`,
    ...others.slice(0, MAX_LISTED).map((n) => `${n.ip} — appareil · ${n.mac}`),
  ];
  if (others.length > MAX_LISTED) lines.push(`… et ${others.length - MAX_LISTED} autre(s).`);
  advice.push(`Appareils vus depuis cet ordinateur :\n${lines.join('\n')}`);
  advice.push("Cette carte est partielle : elle ne montre que les appareils avec lesquels cet ordinateur a récemment communiqué. Je n'analyse pas le réseau (pas de balayage) et je ne me connecte à aucun autre appareil.");
  advice.push('Les routeurs, switchs et pare-feux ne sont pas administrés par cet agent : un technicien peut le faire.');

  if (facts.gatewayReachable === false) {
    problems.push('gateway_unreachable');
    return {
      summary: `La passerelle ${facts.gateway} ne répond pas : la box ou le routeur est probablement éteint, bloqué ou débranché.`,
      problems,
      actions: [],
      advice: ['Redémarrez la box ou le routeur (débranchez-le 30 secondes, puis rebranchez-le), puis relancez cette vérification.', ...advice],
      healthy: false,
      needsHuman: false,
    };
  }

  return {
    summary: `Réseau local : passerelle ${facts.gateway} joignable, ${others.length} autre(s) appareil(s) vu(s).`,
    problems,
    actions: [],
    advice,
    healthy: true,
    needsHuman: false,
  };
}

export function networkMapSkill(): Skill {
  return {
    id: 'lan-map',
    title: 'Réseau local : appareils connectés',
    verifyQuestion: 'Ces informations vous suffisent-elles ?',
    async diagnose(runner) {
      return diagnoseNetworkMap(parseNetworkMapFacts(await readScript(runner, COLLECT_SCRIPT, 'La carte du réseau')));
    },
  };
}
