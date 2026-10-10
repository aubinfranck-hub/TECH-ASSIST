import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, psQuote, readScript, runScript, safeLabel, tracked } from './common.js';

/**
 * Programmes au démarrage. Deux niveaux :
 *  - les programmes CONNUS comme inutiles au démarrage (lanceurs de jeux, messageries, mises à jour d'applis…) sont désactivés par l'agent,
 *    avec l'accord du client, comme le fait le Gestionnaire des tâches : rien n'est désinstallé ni supprimé, tout est réversible ;
 *  - pour le reste, l'agent ouvre la page officielle « Applications de démarrage » où le client choisit lui-même.
 * Jamais touchés : antivirus, pilotes, sauvegarde, synchronisation, accès à distance.
 */

export type StartupKind = 'run-user' | 'run-machine' | 'run-machine32' | 'folder-user' | 'folder-common' | 'other';

export interface StartupItem {
  name: string;
  location: string;
  /** Désactivé dans le Gestionnaire des tâches : ne se lance plus au démarrage. */
  enabled: boolean;
  kind: StartupKind;
}

export interface StartupFacts {
  items: StartupItem[];
  admin: boolean | null;
}

/** Lecture seule : commandes lancées au démarrage de Windows et à l'ouverture de session, avec leur état (activé / désactivé). */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function Get-StartupState([string]$hive, [string]$sub, [string]$name) {
  try {
    $key = Get-Item -LiteralPath ($hive + ':\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\' + $sub)
    $value = $key.GetValue($name)
    if ($value -is [byte[]] -and $value.Length -gt 0) { return (($value[0] -band 1) -eq 0) }
  } catch { }
  return $true
}
$items = @(Get-CimInstance -ClassName Win32_StartupCommand | ForEach-Object {
  $loc = [string]$_.Location
  $name = [string]$_.Name
  $kind = 'other'
  $enabled = $true
  if ($loc -match '^HKLM\\.*WOW6432Node.*\\Run$') { $kind = 'run-machine32'; $enabled = Get-StartupState 'HKLM' 'Run32' $name }
  elseif ($loc -match '^HKLM\\.*\\Run$') { $kind = 'run-machine'; $enabled = Get-StartupState 'HKLM' 'Run' $name }
  elseif ($loc -match '^HKU\\.*\\Run$') { $kind = 'run-user'; $enabled = Get-StartupState 'HKCU' 'Run' $name }
  elseif ($loc -eq 'Startup') { $kind = 'folder-user'; $enabled = Get-StartupState 'HKCU' 'StartupFolder' $name }
  elseif ($loc -eq 'Common Startup') { $kind = 'folder-common'; $enabled = Get-StartupState 'HKLM' 'StartupFolder' $name }
  [pscustomobject]@{ name = $name; location = $loc; kind = $kind; enabled = [bool]$enabled }
})
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ items = $items; admin = $admin } | ConvertTo-Json -Depth 3 -Compress
`);

const KINDS: StartupKind[] = ['run-user', 'run-machine', 'run-machine32', 'folder-user', 'folder-common', 'other'];

export function parseStartupFacts(stdout: string): StartupFacts {
  const raw = extractJson(stdout);
  return {
    items: asArray<Record<string, unknown>>(raw.items)
      .map((i) => ({
        name: safeLabel(i.name, 60),
        location: safeLabel(i.location, 80),
        enabled: i.enabled !== false,
        kind: KINDS.includes(i.kind as StartupKind) ? (i.kind as StartupKind) : 'other',
      }))
      .filter((i) => i.name),
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

/** Au-delà, le démarrage est visiblement chargé. */
export const MANY_STARTUP = 10;

/** Jamais désactivé par l'agent, même si le nom ressemble à une application de la liste. */
const NEVER = /defender|security|antivir|antimalware|norton|mcafee|kaspersky|avast|\bavg\b|eset|bitdefender|malwarebytes|realtek|nvidia|\bintel|\bamd\b|synaptics|touchpad|bluetooth|audio|driver|vpn|backup|onedrive|rustdesk|tech ?assist|anydesk|teamviewer/i;

/** Applications dont le lancement au démarrage n'apporte presque rien (elles s'ouvrent à la demande) : lanceurs de jeux, messageries, mises à jour d'applis. */
const NON_ESSENTIAL: RegExp[] = [
  /^spotify/i,
  /^discord/i,
  /^steam/i,
  /epic ?games/i,
  /^battle\.?net/i,
  /^(ea ?app|eadesktop|origin)/i,
  /ubisoft|uplay/i,
  /^skype/i,
  /^(com\.squirrel\.)?teams?\b|ms ?teams|microsoft ?teams/i,
  /^zoom/i,
  /^adobe|^acrotray|^ccxprocess|^creative ?cloud|^cccloud/i,
  /^jusched|^java.*update/i,
  /^itunes|^ipod/i,
  /^opera/i,
  /^(your ?phone|phone ?link)/i,
  /^cortana/i,
  /microsoftedge.*autolaunch/i,
  /^(utorrent|bittorrent)/i,
];

export function isNonEssential(name: string): boolean {
  return !NEVER.test(name) && NON_ESSENTIAL.some((r) => r.test(name));
}

/** Les entrées du registre (Run) sont désactivables comme le fait le Gestionnaire des tâches ; les raccourcis du dossier Démarrage restent au client. */
const DISABLABLE: StartupKind[] = ['run-user', 'run-machine', 'run-machine32'];

const REG = String.raw`Software\Microsoft\Windows\CurrentVersion`;
const TARGET_KEYS: Record<'run-user' | 'run-machine' | 'run-machine32', { hive: 'CU' | 'LM'; run: string; approved: string }> = {
  'run-user': { hive: 'CU', run: `${REG}\\Run`, approved: `${REG}\\Explorer\\StartupApproved\\Run` },
  'run-machine': { hive: 'LM', run: `SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run`, approved: `SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run` },
  'run-machine32': { hive: 'LM', run: `SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run`, approved: `SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run32` },
};

/** Candidats à la désactivation : actifs, connus comme inutiles au démarrage, dans une clé Run, et dont le nom passe en toute sécurité dans un script. */
export function disableCandidates(facts: StartupFacts): StartupItem[] {
  const seen = new Set<string>();
  return facts.items.filter((i) => {
    if (i.enabled === false || !DISABLABLE.includes(i.kind) || !isNonEssential(i.name)) return false;
    try {
      psQuote(i.name);
    } catch {
      return false;
    }
    const key = `${i.kind}|${i.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Désactive au démarrage les programmes listés : valeur « StartupApproved » (celle du Gestionnaire des tâches), rien n'est supprimé. */
const disableStartupApps = (targets: StartupItem[]): Action => {
  const names = [...new Set(targets.map((t) => t.name))];
  const list = names.slice(0, 8).join(', ') + (names.length > 8 ? ` et ${names.length - 8} autre(s)` : '');
  const literal = targets
    .map((t) => {
      const k = TARGET_KEYS[t.kind as 'run-user' | 'run-machine' | 'run-machine32'];
      return `  @{ name = ${psQuote(t.name)}; hive = '${k.hive}'; run = ${psQuote(k.run)}; approved = ${psQuote(k.approved)} }`;
    })
    .join(',\n');
  return {
    id: 'disable_startup_apps',
    title: 'Désactiver au démarrage les programmes inutiles',
    explanation: `Je désactive au démarrage de Windows : ${list}. Ils ne sont PAS désinstallés : ils restent disponibles et se lancent quand vous les ouvrez. Windows démarre plus vite et garde plus de mémoire libre (le gain se sent surtout au prochain allumage). Pour en réactiver un : Gestionnaire des tâches > Démarrage, ou Paramètres > Applications > Démarrage.`,
    requiresAdmin: targets.some((t) => t.kind !== 'run-user'),
    verified: false, // la valeur « StartupApproved » est celle du Gestionnaire des tâches, mais Microsoft ne la documente pas
    run: async (runner) => {
      const res = await runScript(
        runner,
        guarded(`$targets = @(
${literal}
)
$disabled = 0
foreach ($t in $targets) {
  $root = if ($t.hive -eq 'CU') { [Microsoft.Win32.Registry]::CurrentUser } else { [Microsoft.Win32.Registry]::LocalMachine }
  $run = $root.OpenSubKey($t.run)
  if ($run -eq $null -or $run.GetValue($t.name) -eq $null) { continue }
  $approved = $root.CreateSubKey($t.approved)
  $approved.SetValue($t.name, [byte[]](3,0,0,0,0,0,0,0,0,0,0,0), [Microsoft.Win32.RegistryValueKind]::Binary)
  $disabled += 1
}
Write-Output ('DISABLED:' + $disabled)`),
        60_000,
      );
      if (!res.ok) return res;
      const n = Number(/DISABLED:(\d+)/.exec(res.message)?.[1] ?? NaN);
      if (!Number.isFinite(n)) return res;
      if (n === 0) return { ok: true, message: "Ces programmes n'ont pas été trouvés pour ce compte : rien n'a été changé." };
      const effect = `${n} programme${n > 1 ? 's' : ''} retiré${n > 1 ? 's' : ''} du démarrage`;
      return { ok: true, message: effect, effect };
    },
  };
};

const openStartupSettings = (): Action => ({
  id: 'open_startup_settings',
  title: 'Ouvrir la liste des programmes au démarrage',
  explanation: "J'ouvre la page « Applications de démarrage » des Paramètres Windows. Vous y désactivez avec les interrupteurs les programmes dont vous n'avez pas besoin dès l'allumage (messageries, lanceurs de jeux, mises à jour d'applis…). Rien n'est supprimé et vous pouvez les réactiver à tout moment.",
  requiresAdmin: false,
  verified: true,
  followUp: "La page est ouverte : désactivez les programmes inutiles (gardez l'antivirus, les pilotes et vos logiciels de travail), puis revenez ici.",
  run: (runner) => runScript(runner, guarded(`Start-Process 'ms-settings:startupapps'\nWrite-Output 'OK'`)),
});

/** Fonction pure. `tried` : actions déjà lancées (une action n'est jamais reproposée). */
export function diagnoseStartup(facts: StartupFacts, opened = false, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const active = facts.items.filter((i) => i.enabled !== false);
  const candidates = tried.has('disable_startup_apps') ? [] : disableCandidates(facts);
  const many = active.length > MANY_STARTUP && !opened && !(candidates.length > 0); // la désactivation passe d'abord ; la page des Paramètres ne vient qu'ensuite
  const names = active.slice(0, 8).map((i) => i.name).join(', ');
  const candidateNames = [...new Set(candidates.map((i) => i.name))];
  const actions: Action[] = [];
  const problems: string[] = [];
  let summary: string;
  if (candidates.length > 0) {
    problems.push('startup_nonessential');
    actions.push(disableStartupApps(candidates));
    summary = `${active.length} programmes se lancent au démarrage de Windows. ${candidateNames.length} ne sont pas indispensables (${candidateNames.slice(0, 6).join(', ')}) : je peux les désactiver sans les désinstaller.`;
  } else if (many) {
    problems.push('many_startup');
    actions.push(openStartupSettings());
    summary = `${active.length} programmes se lancent au démarrage de Windows (dont : ${names}). Cela ralentit l'allumage.`;
  } else {
    summary = `${active.length} programme(s) au démarrage : c'est raisonnable.`;
  }
  return { summary, problems, actions, advice: [], healthy: problems.length === 0, needsHuman: false, metrics: { startupActive: active.length } };
}

export function startupSkill(): Skill {
  const tried = new Set<string>();
  return {
    id: 'startup',
    title: 'Démarrage : programmes qui ralentissent',
    verifyQuestion: 'Windows démarre-t-il plus vite ?',
    async diagnose(runner) {
      const d = diagnoseStartup(parseStartupFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic du démarrage')), tried.has('open_startup_settings'), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
