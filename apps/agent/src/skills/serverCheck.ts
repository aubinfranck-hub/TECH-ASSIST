import type { Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, psQuote, readScript } from './common.js';

/**
 * « Je n'arrive pas à accéder au serveur » : test en lecture seule, de ce PC vers le serveur :
 * nom (DNS) → ping → ports 445 (partage de fichiers), 3389 (bureau à distance), 80/443 (web).
 * Aucune connexion, aucun mot de passe : on regarde seulement si les portes répondent.
 */

/** Nom DNS ou adresse IPv4 : lettres, chiffres, points et tirets, début/fin alphanumériques. */
export const SERVER_HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
export const SERVER_PORTS = [445, 3389, 80, 443] as const;
const PORT_LABEL: Record<number, string> = { 445: 'Partage de fichiers (445)', 3389: 'Bureau à distance (3389)', 80: 'Web (80)', 443: 'Web sécurisé (443)' };

export interface ServerFacts {
  host: string;
  /** Adresse de la box joignable : le problème vient-il de ce PC ? null si pas de box. */
  localOk: boolean | null;
  dnsAddresses: string[];
  pingOk: boolean;
  ports: { port: number; open: boolean }[];
}

export function serverCollectScript(host: string): string {
  if (!SERVER_HOST.test(host)) throw new Error('Nom ou adresse de serveur non valide');
  return guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$target = ${psQuote(host)}
$gw = (Get-NetIPConfiguration | ForEach-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).NextHop
$localOk = $null
if ($gw) { $localOk = [bool](Test-Connection -ComputerName $gw -Count 2 -Quiet) }
$addresses = @()
try { $addresses = @(Resolve-DnsName -Name $target -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | ForEach-Object { [string]$_.IPAddress }) } catch { }
$pingOk = [bool](Test-Connection -ComputerName $target -Count 2 -Quiet)
$ports = @(445, 3389, 80, 443 | ForEach-Object {
  $open = $false
  $client = New-Object System.Net.Sockets.TcpClient
  try { $open = $client.ConnectAsync($target, $_).Wait(3000) -and $client.Connected } catch { }
  $client.Close()
  [pscustomobject]@{ port = [int]$_; open = [bool]$open }
})
[pscustomobject]@{ host = $target; localOk = $localOk; dnsAddresses = $addresses; pingOk = $pingOk; ports = $ports } | ConvertTo-Json -Depth 3 -Compress
`);
}

export function parseServerFacts(stdout: string, host: string): ServerFacts {
  const raw = extractJson(stdout);
  return {
    host,
    localOk: typeof raw.localOk === 'boolean' ? raw.localOk : null,
    dnsAddresses: asArray<unknown>(raw.dnsAddresses).map(String).filter(Boolean),
    pingOk: raw.pingOk === true,
    ports: asArray<Record<string, unknown>>(raw.ports)
      .filter((p) => typeof p.port === 'number' && (SERVER_PORTS as readonly number[]).includes(p.port))
      .map((p) => ({ port: p.port as number, open: p.open === true })),
  };
}

/** Tableau 🟢/🔴 du chemin vers le serveur. */
export function formatServerTable(f: ServerFacts): string {
  const rows: [string, boolean][] = [
    ['Réseau de ce PC (box)', f.localOk !== false],
    [`Nom du serveur (${f.dnsAddresses[0] ?? 'introuvable'})`, f.dnsAddresses.length > 0],
    ['Réponse au ping', f.pingOk],
    ...f.ports.map((p): [string, boolean] => [PORT_LABEL[p.port] ?? String(p.port), p.open]),
  ];
  const width = Math.max(...rows.map(([l]) => l.length));
  return rows.map(([l, ok]) => `${l.padEnd(width)}  ${ok ? '🟢' : '🔴'}`).join('\n');
}

export function diagnoseServer(f: ServerFacts): Diagnosis {
  const table = formatServerTable(f);
  const anyPort = f.ports.some((p) => p.open);
  const smb = f.ports.find((p) => p.port === 445);
  const wrap = (cause: string, problems: string[], advice: string[], needsHuman: boolean): Diagnosis => ({
    actions: [],
    summary: `Serveur « ${f.host} » : ${cause}\n${table}`,
    problems,
    advice,
    healthy: problems.length === 0,
    needsHuman,
  });

  if (f.localOk === false) {
    return wrap("le problème vient de ce PC : il ne joint même pas votre box.", ['local_network'], ['Utilisez la vérification « Internet / Wi-Fi / réseau » : tant que ce PC n\'est pas connecté, le serveur est inaccessible.'], false);
  }
  if (f.dnsAddresses.length === 0) {
    return wrap("son nom n'est pas reconnu (DNS).", ['dns_name'], ['Vérifiez l\'orthographe du nom. Si le nom est bon, le serveur DNS de l\'entreprise ne répond pas ou ne connaît pas ce serveur : à signaler à votre responsable informatique.'], true);
  }
  if (!f.pingOk && !anyPort) {
    return wrap('il ne répond à rien (éteint, débranché ou bloqué par un pare-feu).', ['server_unreachable'], ['Vérifiez que le serveur est allumé et branché. Si d\'autres personnes y accèdent, le souci vient de ce PC ou de sa liaison.'], true);
  }
  if (f.ports.length > 0 && !anyPort) {
    return wrap('il répond au ping mais aucun service ne répond (partage, bureau à distance, web).', ['services_down'], ['Un service est arrêté ou un pare-feu bloque : à voir côté serveur.'], true);
  }
  if (smb && !smb.open) {
    return wrap("il répond, mais le partage de fichiers (port 445) est fermé.", ['smb_closed'], ['Le service de partage est arrêté ou bloqué par un pare-feu : à voir côté serveur.'], true);
  }
  return wrap('il est joignable depuis ce PC.', [], ['Si l\'accès échoue encore, la cause est probablement une autorisation (mot de passe, droits sur le dossier) : à demander à votre responsable informatique.'], false);
}

export function serverCheckSkill(host: string): Skill {
  const script = serverCollectScript(host);
  return {
    id: 'server-check',
    title: `Serveur « ${host} » : accès`,
    verifyQuestion: 'Arrivez-vous maintenant à accéder au serveur ?',
    async diagnose(runner) {
      return diagnoseServer(parseServerFacts(await readScript(runner, script, 'Le test du serveur', 90_000), host));
    },
  };
}
