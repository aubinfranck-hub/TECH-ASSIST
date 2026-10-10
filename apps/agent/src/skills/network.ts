import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, psQuote, readScript, runScript } from './common.js';
import { withRestorePoint } from './safety.js';
import { serviceSkill } from './services.js';

/**
 * Compétence « réseau » : d'abord les services dont dépend le réseau (voir services.ts),
 * puis le chemin complet : carte réseau → adresse (DHCP) → box → Internet → noms de sites (DNS) → HTTPS.
 * Le premier maillon cassé est celui qu'on traite ; les suivants sont revérifiés ensuite.
 */

/** Nom de carte réseau accepté (lettres, chiffres, espace, _ . ( ) # -) : il entre dans un script. */
const ADAPTER_NAME = /^[\p{L}\p{N} _.()#-]{1,60}$/u;

export interface NetAdapter {
  name: string;
  description: string;
  /** Up, Disconnected, Disabled, Not Present… */
  status: string;
  /** Carte physique (Ethernet, Wi-Fi) et non virtuelle (VPN, Hyper-V…). */
  physical: boolean;
}

export interface NetConfig {
  alias: string;
  ipv4: string[];
  gateway: string[];
  dns: string[];
}

export interface NetworkFacts {
  adapters: NetAdapter[];
  configs: NetConfig[];
  gatewayOk: boolean | null;
  internetOk: boolean;
  dnsOk: boolean;
  httpsOk: boolean;
  proxy: { enabled: boolean; server: string; autoConfig: string };
  admin: boolean | null;
}

/** Lecture seule : cartes, adresses, joignabilité (box, Internet, DNS, HTTPS), proxy, droits. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$adapters = @(Get-NetAdapter | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; description = [string]$_.InterfaceDescription; status = [string]$_.Status; physical = [bool]$_.HardwareInterface } })
$configs = @(Get-NetIPConfiguration | ForEach-Object {
  [pscustomobject]@{
    alias = [string]$_.InterfaceAlias
    ipv4 = @($_.IPv4Address | ForEach-Object { [string]$_.IPAddress })
    gateway = @($_.IPv4DefaultGateway | ForEach-Object { [string]$_.NextHop })
    dns = @($_.DNSServer | ForEach-Object { $_.ServerAddresses } | ForEach-Object { [string]$_ })
  }
})
$gw = $null
foreach ($c in $configs) { if ($c.gateway.Count -gt 0) { $gw = $c.gateway[0]; break } }
$gatewayOk = $null
if ($gw) { $gatewayOk = [bool](Test-Connection -ComputerName $gw -Count 2 -Quiet) }
$internetOk = [bool](Test-Connection -ComputerName 1.1.1.1 -Count 2 -Quiet)
$dnsOk = $false
try { $null = Resolve-DnsName -Name 'www.microsoft.com' -Type A -DnsOnly -ErrorAction Stop; $dnsOk = $true } catch { }
$httpsOk = $false
try { $r = Invoke-WebRequest -Uri 'https://www.msftconnecttest.com/connecttest.txt' -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop; $httpsOk = ($r.StatusCode -eq 200) } catch { }
$p = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$proxy = [pscustomobject]@{ enabled = ([int]$p.ProxyEnable -eq 1); server = [string]$p.ProxyServer; autoConfig = [string]$p.AutoConfigURL }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ adapters = $adapters; configs = $configs; gatewayOk = $gatewayOk; internetOk = $internetOk; dnsOk = $dnsOk; httpsOk = $httpsOk; proxy = $proxy; admin = $admin } | ConvertTo-Json -Depth 5 -Compress
`);

const strings = (v: unknown) => asArray<unknown>(v).map(String).filter(Boolean);

export function parseNetworkFacts(stdout: string): NetworkFacts {
  const raw = extractJson(stdout);
  const proxy = (raw.proxy ?? {}) as Record<string, unknown>;
  return {
    adapters: asArray<Record<string, unknown>>(raw.adapters).map((a) => ({
      name: String(a.name ?? ''),
      description: String(a.description ?? ''),
      status: String(a.status ?? ''),
      physical: a.physical === true,
    })),
    configs: asArray<Record<string, unknown>>(raw.configs).map((c) => ({
      alias: String(c.alias ?? ''),
      ipv4: strings(c.ipv4),
      gateway: strings(c.gateway),
      dns: strings(c.dns),
    })),
    gatewayOk: typeof raw.gatewayOk === 'boolean' ? raw.gatewayOk : null,
    internetOk: raw.internetOk === true,
    dnsOk: raw.dnsOk === true,
    httpsOk: raw.httpsOk === true,
    proxy: { enabled: proxy.enabled === true, server: String(proxy.server ?? ''), autoConfig: String(proxy.autoConfig ?? '') },
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

const run = (runner: Parameters<typeof runScript>[0], script: string) => runScript(runner, script, 60_000);

function enableAdapterAction(adapter: NetAdapter): Action {
  const name = adapter.name;
  return {
    id: 'enable_adapter',
    title: `Réactiver la carte réseau « ${name} »`,
    explanation: `La carte réseau « ${name} » est désactivée dans Windows : aucune connexion n'est possible. Je la réactive, comme le ferait un clic droit « Activer » dans les connexions réseau.`,
    requiresAdmin: true,
    verified: true,
    run: (runner) =>
      run(
        runner,
        guarded(`Enable-NetAdapter -Name ${psQuote(name)} -Confirm:$false
for ($i = 0; $i -lt 20; $i++) {
  if ((Get-NetAdapter -Name ${psQuote(name)}).Status -ne 'Disabled') { break }
  Start-Sleep -Seconds 1
}
if ((Get-NetAdapter -Name ${psQuote(name)}).Status -eq 'Disabled') { throw 'La carte reste désactivée' }
Write-Output 'OK'`),
      ),
  };
}

function renewIpAction(): Action {
  return {
    id: 'renew_ip',
    title: 'Redemander une adresse réseau à la box',
    explanation:
      "Votre ordinateur n'a pas reçu d'adresse de votre box (adresse « 169.254… »). Je libère puis redemande l'adresse : la connexion peut se couper quelques secondes.",
    requiresAdmin: true,
    verified: true,
    run: (runner) =>
      run(
        runner,
        guarded(`ipconfig /release | Out-Null
$out = ipconfig /renew
if ($LASTEXITCODE -ne 0) { throw "Windows n'a pas obtenu d'adresse réseau : votre box ne répond pas." }
Write-Output 'OK'`),
      ),
  };
}

function flushDnsAction(): Action {
  return {
    id: 'flush_dns',
    title: 'Vider la mémoire des noms de sites (DNS)',
    explanation:
      "Internet répond mais les noms de sites ne sont pas trouvés. Je vide la mémoire des noms de sites de Windows ; elle se reconstruira toute seule. Aucun fichier n'est touché.",
    requiresAdmin: true,
    verified: true,
    run: (runner) => run(runner, guarded(`Clear-DnsClientCache\nWrite-Output 'OK'`)),
  };
}

function disableProxyAction(proxy: NetworkFacts['proxy']): Action {
  const what = [proxy.server && `serveur ${proxy.server}`, proxy.autoConfig && `script ${proxy.autoConfig}`].filter(Boolean).join(', ');
  return {
    id: 'disable_proxy',
    title: 'Désactiver le proxy Windows',
    explanation:
      `Windows envoie votre navigation par un proxy (${what || 'configuré'}) qui ne répond pas. ` +
      "Si vous n'êtes pas sur le réseau d'une entreprise, il a pu être ajouté par un logiciel indésirable. " +
      'Je le désactive (notez cette adresse si vous voulez la remettre). Refusez si vous êtes sur un réseau professionnel.',
    requiresAdmin: false,
    verified: true,
    run: (runner) =>
      run(
        runner,
        guarded(String.raw`$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $k -Name ProxyEnable -Value 0
Remove-ItemProperty -Path $k -Name AutoConfigURL -ErrorAction SilentlyContinue
Write-Output 'OK'`),
      ),
  };
}

const isApipa = (ip: string) => ip.startsWith('169.254.');

function restartAdapterAction(adapter: NetAdapter): Action {
  const name = adapter.name;
  return {
    id: 'restart_adapter',
    title: `Redémarrer la carte réseau « ${name} »`,
    explanation: `Je coupe puis rallume la carte réseau « ${name} » (comme la désactiver puis l'activer). La connexion se coupe quelques secondes. Rien d'autre n'est modifié.`,
    requiresAdmin: true,
    verified: true,
    run: (runner) => run(runner, guarded(`Restart-NetAdapter -Name ${psQuote(name)} -Confirm:$false\nStart-Sleep -Seconds 5\nWrite-Output 'OK'`)),
  };
}

function resetDnsServersAction(adapter: NetAdapter): Action {
  const name = adapter.name;
  return {
    id: 'reset_dns_servers',
    title: `Remettre les serveurs DNS de « ${name} » en automatique`,
    explanation: `Les noms de sites ne sont toujours pas trouvés. Je remets les serveurs DNS de la carte « ${name} » en automatique (ceux de votre box). Si vous aviez saisi des DNS à la main, notez-les avant : ils seront effacés.`,
    requiresAdmin: true,
    verified: true,
    run: (runner) => run(runner, guarded(`Set-DnsClientServerAddress -InterfaceAlias ${psQuote(name)} -ResetServerAddresses\nClear-DnsClientCache\nWrite-Output 'OK'`)),
  };
}

/** Dernier recours côté Windows : réinitialise Winsock et la pile TCP/IP. Difficile à défaire : point de restauration d'abord, redémarrage ensuite. */
function resetNetworkStackAction(): Action {
  return withRestorePoint({
    id: 'reset_network_stack',
    title: 'Réinitialiser la pile réseau de Windows (Winsock et TCP/IP)',
    explanation:
      "Les corrections simples n'ont pas suffi. Je réinitialise les composants réseau de Windows (Winsock et TCP/IP). Vos fichiers ne sont pas touchés, mais les réglages réseau avancés (adresse fixe, par exemple) reviennent aux valeurs d'origine ; un redémarrage est nécessaire.",
    requiresAdmin: true,
    verified: true,
    needsReboot: true,
    run: (runner) =>
      run(
        runner,
        guarded(`netsh winsock reset | Out-Null
if ($LASTEXITCODE -ne 0) { throw "La réinitialisation de Winsock a échoué." }
netsh int ip reset | Out-Null
if ($LASTEXITCODE -ne 0) { throw "La réinitialisation de TCP/IP a échoué." }
ipconfig /flushdns | Out-Null
Write-Output 'OK'`),
      ),
  });
}

export interface ChainLink {
  label: string;
  /** null : non testé (maillon précédent cassé). */
  ok: boolean | null;
}

/** Maillons du chemin réseau, pour le tableau 🟢/🔴. Le premier 🔴 est la cause ; ce qui suit n'est pas testé. */
export function networkChain(facts: NetworkFacts): ChainLink[] {
  const up = facts.adapters.filter((a) => a.physical && a.status.toLowerCase() === 'up');
  const upAliases = new Set(up.map((a) => a.name.toLowerCase()));
  const live = facts.configs.filter((c) => upAliases.has(c.alias.toLowerCase()));
  const hasAddress = live.some((c) => c.ipv4.some((ip) => !isApipa(ip)));
  const results: [string, boolean | null][] = [
    ['Carte réseau', up.length > 0],
    ['Adresse IP', hasAddress],
    ['Passerelle (box)', facts.gatewayOk],
    ['Internet', facts.internetOk],
    ['DNS (noms de sites)', facts.dnsOk],
    ['Sites sécurisés (https)', facts.httpsOk],
  ];
  const chain: ChainLink[] = [];
  let broken = false;
  for (const [label, ok] of results) {
    if (broken) chain.push({ label, ok: null });
    else {
      chain.push({ label, ok });
      if (ok === false) broken = true;
    }
  }
  return chain;
}

export function formatChain(chain: ChainLink[]): string {
  const width = Math.max(...chain.map((l) => l.label.length));
  return chain.map((l) => `${l.label.padEnd(width)}  ${l.ok === null ? '⚪ non testé' : l.ok ? '🟢' : '🔴'}`).join('\n');
}

/** Fonction pure : du premier maillon cassé au diagnostic. */
/** `tried` : actions déjà essayées ; on passe alors à l'hypothèse suivante au lieu de recommencer. */
export function diagnoseNetwork(facts: NetworkFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const problems: string[] = [];
  const sentences: string[] = [];
  const advice: string[] = [];
  const actions: Action[] = [];
  let needsHuman = false;

  const physical = facts.adapters.filter((a) => a.physical);
  const up = physical.filter((a) => a.status.toLowerCase() === 'up');
  const disabled = physical.filter((a) => a.status.toLowerCase() === 'disabled');

  if (up.length === 0) {
    if (disabled.length > 0) {
      problems.push('adapter_disabled');
      for (const adapter of disabled) {
        sentences.push(`La carte réseau « ${adapter.name} » est désactivée.`);
        if (ADAPTER_NAME.test(adapter.name)) actions.push(enableAdapterAction(adapter));
        else advice.push(`Réactivez la carte « ${adapter.name} » dans Paramètres > Réseau > Paramètres avancés.`);
      }
    } else if (physical.length === 0) {
      problems.push('no_adapter');
      sentences.push("Windows ne voit aucune carte réseau : le pilote est probablement absent ou en panne.");
      needsHuman = true;
    } else {
      problems.push('no_link');
      sentences.push("L'ordinateur n'est connecté à aucun réseau.");
      advice.push('Wi-Fi : activez-le (touche ou interrupteur du clavier) et choisissez votre réseau. Câble : vérifiez qu\'il est bien branché des deux côtés.');
    }
  } else {
    const upAliases = new Set(up.map((a) => a.name.toLowerCase()));
    const live = facts.configs.filter((c) => upAliases.has(c.alias.toLowerCase()));
    const hasAddress = live.some((c) => c.ipv4.some((ip) => !isApipa(ip)));
    const usable = up.find((a) => ADAPTER_NAME.test(a.name));
    const onlyApipa = !hasAddress && live.some((c) => c.ipv4.some(isApipa));

    if (!hasAddress) {
      problems.push(onlyApipa ? 'dhcp_failed' : 'no_address');
      sentences.push("Votre ordinateur n'a pas reçu d'adresse réseau de la box.");
      actions.push(renewIpAction());
      if (tried.has('renew_ip') && usable) actions.push(restartAdapterAction(usable));
      if (tried.has('restart_adapter')) actions.push(resetNetworkStackAction());
      advice.push('Si cela persiste, redémarrez votre box (débranchez-la 30 secondes).');
    } else if (facts.gatewayOk === false) {
      problems.push('gateway_unreachable');
      sentences.push('Votre ordinateur ne parvient pas à joindre votre box.');
      if (usable) actions.push(restartAdapterAction(usable));
      if (tried.has('restart_adapter')) actions.push(resetNetworkStackAction());
      advice.push('Redémarrez votre box (débranchez-la 30 secondes), puis vérifiez que vous êtes bien connecté au bon réseau.');
    } else if (!facts.internetOk) {
      problems.push('no_internet');
      sentences.push('Votre réseau local fonctionne mais Internet est inaccessible.');
      advice.push("Le problème vient sans doute de la box ou de l'opérateur (forfait épuisé, coupure). Redémarrez la box, ou contactez votre opérateur.");
    } else if (!facts.dnsOk) {
      problems.push('dns_failed');
      sentences.push("Internet répond, mais les noms de sites ne sont pas trouvés (DNS).");
      actions.push(flushDnsAction());
      if (tried.has('flush_dns') && usable) actions.push(resetDnsServersAction(usable));
      if (tried.has('reset_dns_servers')) actions.push(resetNetworkStackAction());
    } else if (!facts.httpsOk) {
      const proxied = facts.proxy.enabled || facts.proxy.autoConfig !== '';
      if (proxied) {
        problems.push('proxy_blocking');
        sentences.push('Un proxy est configuré dans Windows et la navigation sécurisée ne passe pas.');
        actions.push(disableProxyAction(facts.proxy));
      } else {
        problems.push('https_blocked');
        sentences.push('Les sites sécurisés (https) ne s\'ouvrent pas, alors que le reste du réseau répond.');
        advice.push("Vérifiez la date et l'heure de l'ordinateur (une heure fausse bloque les sites sécurisés), puis votre antivirus ou pare-feu.");
      }
    }
  }

  if (facts.admin === false && actions.some((a) => a.requiresAdmin)) {
    advice.push("L'agent n'est pas lancé en administrateur : ces corrections échoueront sans ce droit.");
  }

  const healthy = problems.length === 0;
  const chain = formatChain(networkChain(facts));
  return {
    summary: healthy ? `Côté Windows, la connexion à Internet fonctionne.\n${chain}` : `${sentences.join(' ')}\n${chain}`,
    problems,
    actions,
    advice,
    healthy,
    needsHuman,
  };
}

export function networkSkill(): Skill {
  const services = serviceSkill('network');
  const tried = new Set<string>();
  return {
    id: 'network',
    title: 'Réseau : pas d’Internet ou de Wi-Fi',
    verifyQuestion: 'Avez-vous de nouveau accès à Internet ?',
    async diagnose(runner) {
      // Les services d'abord : tant qu'ils sont cassés, le reste du diagnostic n'a pas de sens.
      const base = await services.diagnose(runner);
      if (!base.healthy) return base;
      const d = diagnoseNetwork(parseNetworkFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic réseau')), tried);
      // Chaque action proposée est notée : si le problème persiste, le tour suivant passe à l'hypothèse d'après.
      return { ...d, actions: d.actions.map((a) => ({ ...a, run: (r) => { tried.add(a.id); return a.run(r); } })) };
    },
  };
}
