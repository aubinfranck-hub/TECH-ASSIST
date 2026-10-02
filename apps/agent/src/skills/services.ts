import type { Action, ActionResult, CommandRunner, Diagnosis, Skill } from '../types.js';

/**
 * Compétence « services Windows » : surveille et répare les services dont dépendent
 * l'impression, le réseau, les mises à jour, le Bluetooth, la recherche, l'heure…,
 * ou n'importe quel service désigné par son nom.
 *
 * Elle ne fait que trois choses, toutes proposées au client avant d'agir :
 *   démarrer un service arrêté, réactiver un service désactivé, vider une file d'impression bloquée.
 * Elle n'arrête ni ne désactive jamais un service.
 */

/** Nom de service accepté : jamais de guillemet, d'espace ni de `$` — il entre dans un script PowerShell. */
const SERVICE_NAME = /^[A-Za-z0-9_.-]{1,40}$/;

/**
 * Services que l'agent ne réactive jamais s'ils sont désactivés : ils l'ont très probablement
 * été exprès (durcissement de sécurité), les rouvrir exposerait la machine. Un technicien décide.
 */
const NEVER_ENABLE = new Set(
  ['remoteregistry', 'tlntsvr', 'snmp', 'remoteaccess', 'ssdpsrv', 'upnphost', 'winrm', 'termservice', 'sshd', 'ftpsvc', 'w3svc'],
);

const TRANSIENT_STATES = new Set(['start pending', 'stop pending', 'continue pending', 'pause pending']);

type Startup = 'Automatic' | 'Manual';

export interface ServiceSpec {
  name: string;
  /** Nom lisible, pour la phrase montrée au client. */
  label: string;
  /** Doit tourner en permanence (sinon il démarre à la demande et n'est un souci que s'il est désactivé). */
  mustRun: boolean;
  /** Existe sur tout Windows : son absence est anormale (sinon : composant facultatif, on l'ignore). */
  required: boolean;
  /** Mode de démarrage rétabli si le service a été désactivé. */
  startup: Startup;
}

export interface ServiceProfile {
  id: string;
  title: string;
  verifyQuestion: string;
  services: ServiceSpec[];
  /** Surveille aussi la file d'impression (fichiers en attente depuis longtemps). */
  checkPrintQueue?: boolean;
}

const svc = (name: string, label: string, o: Partial<Omit<ServiceSpec, 'name' | 'label'>> = {}): ServiceSpec => ({
  name,
  label,
  mustRun: o.mustRun ?? true,
  required: o.required ?? true,
  startup: o.startup ?? 'Automatic',
});

export const PROFILES: Record<string, ServiceProfile> = {
  print: {
    id: 'print',
    title: 'Impression : l’imprimante ne répond pas',
    verifyQuestion: 'Pouvez-vous imprimer maintenant ?',
    checkPrintQueue: true,
    services: [svc('Spooler', "Spouleur d'impression"), svc('PrintNotify', "Notifications d'impression", { mustRun: false, required: false, startup: 'Manual' })],
  },
  network: {
    id: 'network',
    title: 'Réseau : pas d’Internet ou de Wi-Fi',
    verifyQuestion: 'Avez-vous de nouveau accès à Internet ?',
    services: [
      svc('Dhcp', 'Client DHCP (adresse réseau)'),
      svc('Dnscache', 'Client DNS (noms de sites)'),
      svc('NlaSvc', 'Détection de connexion réseau'),
      svc('LanmanWorkstation', 'Station de travail (partages réseau)'),
      svc('WlanSvc', 'Wi-Fi (configuration automatique)', { required: false }),
    ],
  },
  update: {
    id: 'update',
    title: 'Mises à jour Windows bloquées',
    verifyQuestion: 'Les mises à jour se lancent-elles maintenant ?',
    services: [
      svc('wuauserv', 'Windows Update', { mustRun: false, startup: 'Manual' }),
      svc('BITS', 'Transfert intelligent en arrière-plan', { mustRun: false, startup: 'Manual' }),
      svc('CryptSvc', 'Services de chiffrement'),
      svc('UsoSvc', 'Orchestrateur de mises à jour', { mustRun: false, required: false }),
    ],
  },
  bluetooth: {
    id: 'bluetooth',
    title: 'Bluetooth ne fonctionne pas',
    verifyQuestion: 'Le Bluetooth fonctionne-t-il maintenant ?',
    services: [svc('bthserv', 'Prise en charge du Bluetooth', { mustRun: false, required: false, startup: 'Manual' })],
  },
  search: {
    id: 'search',
    title: 'La recherche Windows ne trouve rien',
    verifyQuestion: 'La recherche Windows fonctionne-t-elle maintenant ?',
    services: [svc('WSearch', 'Recherche Windows')],
  },
  time: {
    id: 'time',
    title: 'Date et heure incorrectes',
    verifyQuestion: "L'heure est-elle correcte maintenant ?",
    services: [svc('W32Time', "Temps Windows (synchronisation de l'heure)", { mustRun: false, startup: 'Manual' })],
  },
  audio: {
    id: 'audio',
    title: 'Services audio de Windows',
    verifyQuestion: 'Entendez-vous du son maintenant ?',
    services: [svc('AudioEndpointBuilder', 'Générateur de points de terminaison audio'), svc('Audiosrv', 'Audio Windows')],
  },
  core: {
    id: 'core',
    title: 'Services essentiels de Windows',
    verifyQuestion: 'Tout fonctionne-t-il normalement maintenant ?',
    services: [
      svc('EventLog', "Journal d'événements Windows"),
      svc('Winmgmt', 'Infrastructure de gestion Windows (WMI)'),
      svc('Schedule', 'Planificateur de tâches'),
      svc('PlugPlay', 'Plug-and-Play (périphériques)'),
      svc('Themes', 'Thèmes (apparence de Windows)'),
    ],
  },
};

/** Identifiants proposés au client, dans l'ordre du menu. */
export const PROFILE_IDS = ['print', 'network', 'update', 'bluetooth', 'search', 'time'] as const;

export interface ServiceRecord {
  name: string;
  display: string;
  state: string;
  startMode: string;
  dependsOn: string[];
}

export interface ServiceFacts {
  services: ServiceRecord[];
  /** Fichiers en attente dans la file d'impression ; null si non vérifié. */
  spoolFiles: number | null;
  spoolOldestMinutes: number | null;
  admin: boolean | null;
}

function assertServiceName(name: string): string {
  if (!SERVICE_NAME.test(name)) throw new Error(`Nom de service invalide : ${name}`);
  return name;
}

function psList(names: string[]): string {
  return names.map((n) => `'${assertServiceName(n)}'`).join(',');
}

/** Enveloppe commune : échec = message sur stderr + code de sortie 1. */
function guarded(body: string): string {
  return `$ErrorActionPreference = 'Stop'
try {
${body}
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;
}

/** Lecture seule : état des services demandés ET de ceux dont ils dépendent ; file d'impression ; droits. */
export function collectScript(names: string[], checkPrintQueue: boolean): string {
  const spool = checkPrintQueue
    ? String.raw`
$spoolFiles = 0
$spoolOldest = 0
$dir = Join-Path $env:windir 'System32\spool\PRINTERS'
$files = @(Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue)
if ($files.Count -gt 0) {
  $spoolFiles = $files.Count
  $oldest = ($files | Sort-Object LastWriteTime | Select-Object -First 1).LastWriteTime
  $spoolOldest = [int]((Get-Date) - $oldest).TotalMinutes
}`
    : `
$spoolFiles = $null
$spoolOldest = $null`;

  return guarded(`
$ErrorActionPreference = 'SilentlyContinue'
$names = @(${psList(names)})
$seen = @{}
$out = New-Object System.Collections.ArrayList
function Add-Svc([string]$n, [int]$depth) {
  if ($seen.ContainsKey($n) -or $depth -gt 4) { return }
  $seen[$n] = $true
  $c = Get-CimInstance -ClassName Win32_Service -Filter ("Name='" + $n + "'")
  if (-not $c) { return }
  $deps = @()
  $deps = @((Get-Service -Name $n).ServicesDependedOn | ForEach-Object { $_.Name })
  [void]$out.Add([pscustomobject]@{ name = [string]$c.Name; display = [string]$c.DisplayName; state = [string]$c.State; startMode = [string]$c.StartMode; dependsOn = $deps })
  foreach ($d in $deps) { Add-Svc $d ($depth + 1) }
}
foreach ($n in $names) { Add-Svc $n 0 }${spool}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ services = @($out); spoolFiles = $spoolFiles; spoolOldestMinutes = $spoolOldest; admin = $admin } | ConvertTo-Json -Depth 5 -Compress
`);
}

function asArray<T>(value: unknown): T[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}

/** Lit la sortie JSON du script de collecte, de façon tolérante (objet seul, BOM, texte parasite). */
export function parseServiceFacts(stdout: string): ServiceFacts {
  const text = stdout.replace(/^﻿/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Réponse de diagnostic illisible');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const services = asArray<Record<string, unknown>>(raw.services)
    .filter((s) => SERVICE_NAME.test(String(s.name ?? '')))
    .map((s) => ({
      name: String(s.name),
      display: String(s.display ?? s.name).trim(),
      state: String(s.state ?? ''),
      startMode: String(s.startMode ?? ''),
      dependsOn: asArray<unknown>(s.dependsOn).map(String).filter((n) => SERVICE_NAME.test(n)),
    }));
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    services,
    spoolFiles: num(raw.spoolFiles),
    spoolOldestMinutes: num(raw.spoolOldestMinutes),
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

async function run(runner: CommandRunner, script: string): Promise<ActionResult> {
  try {
    const res = await runner.runPowerShell(script, { timeoutMs: 60_000 });
    if (res.exitCode === 0) return { ok: true, message: res.stdout.trim() || 'OK' };
    return { ok: false, message: res.stderr.trim() || `Échec (code ${res.exitCode})` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Démarre le service et attend qu'il tourne réellement (jusqu'à 30 s). */
const startBlock = (name: string) =>
  `$s = Get-Service -Name '${name}'
if ($s.Status -ne 'Running') { Start-Service -Name '${name}' }
$s.Refresh()
$s.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))`;

function startServiceAction(rec: ServiceRecord): Action {
  const name = assertServiceName(rec.name);
  return {
    id: `start_service:${name}`,
    title: `Démarrer « ${rec.display} »`,
    explanation: `Le service « ${rec.display} » (${name}) est arrêté. Je le démarre : cela ne modifie aucun de vos fichiers.`,
    requiresAdmin: true,
    verified: true,
    run: (runner) => run(runner, guarded(`${startBlock(name)}\nWrite-Output 'OK'`)),
  };
}

function enableServiceAction(rec: ServiceRecord, startup: Startup, thenStart: boolean): Action {
  const name = assertServiceName(rec.name);
  const mode = startup === 'Automatic' ? 'automatique' : 'manuel';
  return {
    id: `enable_service:${name}`,
    title: `Réactiver « ${rec.display} »`,
    explanation:
      `Le service « ${rec.display} » (${name}) est désactivé : il ne peut pas fonctionner. ` +
      `Je le remets en démarrage ${mode}${thenStart ? ' et je le démarre' : ''}. ` +
      `Il a pu être désactivé volontairement : refusez si vous n'en êtes pas sûr.`,
    requiresAdmin: true,
    verified: true,
    run: (runner) =>
      run(
        runner,
        guarded(`Set-Service -Name '${name}' -StartupType ${startup}\n${thenStart ? startBlock(name) + '\n' : ''}Write-Output 'OK'`),
      ),
  };
}

function clearPrintQueueAction(files: number): Action {
  return {
    id: 'clear_print_queue',
    title: "Vider la file d'impression bloquée",
    explanation:
      `${files} document(s) sont bloqués dans la file d'impression depuis longtemps. ` +
      "Je l'arrête un instant, je supprime ces documents en attente (ils ne seront pas imprimés, il faudra les relancer), puis je la redémarre.",
    requiresAdmin: true,
    verified: true,
    run: (runner) =>
      run(
        runner,
        guarded(
          String.raw`Stop-Service -Name 'Spooler' -Force
$dir = Join-Path $env:windir 'System32\spool\PRINTERS'
Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue | Remove-Item -Force
` +
            `${startBlock('Spooler')}\nWrite-Output 'OK'`,
        ),
      ),
  };
}

/** Une file d'impression n'est « bloquée » que si des fichiers y traînent depuis plus de 10 minutes. */
const STUCK_QUEUE_MINUTES = 10;

export interface DiagnoseOptions {
  /** Service désigné par le client lui-même : on le veut en marche, quel que soit son mode de démarrage. */
  custom?: boolean;
}

/** Transforme les faits observés en diagnostic et en actions proposées. Fonction pure, testable sans Windows. */
export function diagnoseServices(specs: ServiceSpec[], facts: ServiceFacts, options: DiagnoseOptions = {}): Diagnosis {
  const byName = new Map(facts.services.map((s) => [s.name.toLowerCase(), s]));
  const problems: string[] = [];
  const sentences: string[] = [];
  const advice: string[] = [];
  const actions: Action[] = [];
  let needsHuman = false;
  const planned = new Set<string>();

  const cannotEnable = (name: string) => {
    problems.push(`service_disabled:${name}`);
    needsHuman = true;
  };

  /** Prévoit ce qu'il faut pour qu'un service tourne : ses dépendances d'abord, puis lui-même. */
  const planRun = (rec: ServiceRecord, startup: Startup, depth: number): void => {
    const key = rec.name.toLowerCase();
    if (planned.has(key) || depth > 4) return;
    planned.add(key);
    const state = rec.state.toLowerCase();
    if (state === 'running') return;

    if (TRANSIENT_STATES.has(state)) {
      problems.push(`service_pending:${rec.name}`);
      sentences.push(`Le service « ${rec.display} » est en cours de démarrage ou d'arrêt.`);
      advice.push('Patientez une minute puis relancez l\'analyse.');
      return;
    }

    for (const dep of rec.dependsOn) {
      const depRec = byName.get(dep.toLowerCase());
      if (depRec) planRun(depRec, 'Manual', depth + 1);
    }

    if (rec.startMode.toLowerCase() === 'disabled') {
      if (NEVER_ENABLE.has(key)) {
        sentences.push(`Le service « ${rec.display} » est désactivé, probablement pour des raisons de sécurité : un technicien doit décider.`);
        cannotEnable(rec.name);
        return;
      }
      problems.push(`service_disabled:${rec.name}`);
      sentences.push(`Le service « ${rec.display} » est désactivé.`);
      actions.push(enableServiceAction(rec, startup, true));
      return;
    }
    problems.push(`service_stopped:${rec.name}`);
    sentences.push(`Le service « ${rec.display} » est arrêté.`);
    actions.push(startServiceAction(rec));
  };

  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.name.toLowerCase())) continue;
    seen.add(spec.name.toLowerCase());
    const rec = byName.get(spec.name.toLowerCase());
    if (!rec) {
      if (spec.required || options.custom) {
        problems.push(`service_missing:${spec.name}`);
        sentences.push(
          options.custom
            ? `Le service « ${spec.name} » n'existe pas sur cet ordinateur.`
            : `Le service « ${spec.label} » (${spec.name}) est introuvable : cela dépasse ce que je peux corriger seul.`,
        );
        needsHuman = true;
      }
      continue; // composant facultatif absent (pas de Wi-Fi, de Bluetooth…) : rien à signaler
    }

    if (spec.mustRun) {
      planRun(rec, spec.startup, 0);
    } else if (rec.startMode.toLowerCase() === 'disabled' && !planned.has(rec.name.toLowerCase())) {
      planned.add(rec.name.toLowerCase());
      if (NEVER_ENABLE.has(rec.name.toLowerCase())) {
        sentences.push(`Le service « ${rec.display} » est désactivé, probablement pour des raisons de sécurité : un technicien doit décider.`);
        cannotEnable(rec.name);
      } else {
        problems.push(`service_disabled:${rec.name}`);
        sentences.push(`Le service « ${rec.display} » est désactivé.`);
        actions.push(enableServiceAction(rec, spec.startup, false));
      }
    }
  }

  // La file d'impression n'est regardée que pour une demande qui concerne l'impression.
  const stuck =
    specs.some((s) => s.name === 'Spooler') &&
    facts.spoolFiles !== null &&
    facts.spoolFiles > 0 &&
    (facts.spoolOldestMinutes ?? 0) >= STUCK_QUEUE_MINUTES &&
    // si le spouleur lui-même est arrêté, le démarrer vide peut-être déjà la file : on ne propose pas les deux d'emblée
    !problems.some((p) => p.endsWith(':Spooler'));
  if (stuck) {
    problems.push('print_queue_stuck');
    sentences.push(`${facts.spoolFiles} document(s) sont bloqués dans la file d'impression.`);
    actions.push(clearPrintQueueAction(facts.spoolFiles!));
  }

  if (facts.admin === false && actions.length > 0) {
    advice.push("L'agent n'est pas lancé en administrateur : ces corrections échoueront sans ce droit.");
  }

  const healthy = problems.length === 0;
  return {
    summary: healthy ? 'Côté Windows, les services concernés semblent corrects.' : sentences.join(' '),
    problems,
    actions,
    advice,
    healthy,
    needsHuman,
  };
}

function profileSkill(id: string, title: string, verifyQuestion: string, specs: ServiceSpec[], checkPrintQueue: boolean, custom = false): Skill {
  const names = [...new Set(specs.map((s) => s.name))];
  return {
    id,
    title,
    verifyQuestion,
    async diagnose(runner) {
      const res = await runner.runPowerShell(collectScript(names, checkPrintQueue), { timeoutMs: 60_000 });
      if (res.exitCode !== 0) throw new Error(res.stderr.trim() || 'Le diagnostic des services a échoué');
      return diagnoseServices(specs, parseServiceFacts(res.stdout), { custom });
    },
  };
}

/** Compétence d'un domaine précis (impression, réseau…). */
export function serviceSkill(profileId: string): Skill {
  const profile = PROFILES[profileId];
  if (!profile) throw new Error(`Domaine inconnu : ${profileId}`);
  return profileSkill(profile.id, profile.title, profile.verifyQuestion, profile.services, !!profile.checkPrintQueue);
}

/** Analyse complète : tous les services connus, tous domaines confondus. */
export function windowsHealthSkill(): Skill {
  const all = Object.values(PROFILES);
  return profileSkill(
    'windows',
    'Analyse complète des services Windows',
    'Tout fonctionne-t-il normalement maintenant ?',
    all.flatMap((p) => p.services),
    all.some((p) => p.checkPrintQueue),
  );
}

/** Un service précis, désigné par son nom (celui de services.msc). */
export function customServiceSkill(name: string): Skill {
  assertServiceName(name);
  const spec: ServiceSpec = { name, label: name, mustRun: true, required: true, startup: 'Manual' };
  return profileSkill(`service:${name}`, `Service Windows « ${name} »`, `Le service « ${name} » fonctionne-t-il maintenant ?`, [spec], false, true);
}
