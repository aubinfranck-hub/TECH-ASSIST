import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, nonNegative, psQuote, readScript, runScript } from './common.js';
import { defaultRoots, isAllowedExecutable } from './uninstall.js';

/**
 * Compétence « Office / Outlook » : applications qui ne répondent plus ou plantent à répétition.
 * Actions : fermer une application Office bloquée, lancer Outlook en mode sans échec, réparer Office
 * (réparation rapide Microsoft). L'agent ne touche jamais aux courriers, aux fichiers .ost/.pst ni
 * aux profils Outlook : ces cas vont à un technicien.
 */

/** Seules applications Office que l'agent ferme. */
const OFFICE_PROCESSES = ['OUTLOOK', 'WINWORD', 'EXCEL', 'POWERPNT', 'ONENOTE', 'MSACCESS'] as const;
const LABELS: Record<string, string> = {
  OUTLOOK: 'Outlook',
  WINWORD: 'Word',
  EXCEL: 'Excel',
  POWERPNT: 'PowerPoint',
  ONENOTE: 'OneNote',
  MSACCESS: 'Access',
};

const CRASH_THRESHOLD = 3;
const DATA_FILE_LARGE_MB = 50 * 1024;
const DISK_LOW_GB = 2;

export interface OfficeFacts {
  /** null : aucune installation Office détectée. */
  install: { kind: 'c2r' | 'msi'; version: string; platform: string; culture: string } | null;
  outlookPath: string;
  processes: { name: string; responding: boolean }[];
  /** Plantages relevés dans le journal Windows (7 derniers jours). */
  crashes: { app: string; module: string; minutesAgo: number }[];
  addins: { name: string; friendly: string; loadBehavior: number }[];
  dataFiles: { name: string; sizeMb: number }[];
  diskFreeGb: number | null;
  microsoft365Reachable: boolean | null;
  admin: boolean | null;
}

/** Lecture seule : installation, processus, plantages, compléments Outlook, fichiers de données, disque, accès Microsoft 365. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$install = $null
$c2r = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration'
if ($c2r -and $c2r.VersionToReport) {
  $install = [pscustomobject]@{ kind = 'c2r'; version = [string]$c2r.VersionToReport; platform = [string]$c2r.Platform; culture = [string]$c2r.ClientCulture }
}
$outlookPath = [string](Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE').'(default)'
$wordPath = [string](Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\WINWORD.EXE').'(default)'
if (-not $install -and ($outlookPath -or $wordPath)) { $install = [pscustomobject]@{ kind = 'msi'; version = ''; platform = ''; culture = '' } }
$procs = @(Get-Process -Name OUTLOOK,WINWORD,EXCEL,POWERPNT,ONENOTE,MSACCESS | ForEach-Object { [pscustomobject]@{ name = [string]$_.ProcessName; responding = [bool]$_.Responding } })
$crashes = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000; StartTime = (Get-Date).AddDays(-7) } | Where-Object { $_.Message -match '(OUTLOOK|WINWORD|EXCEL|POWERPNT)\.EXE' } | ForEach-Object {
  $a = [regex]::Match($_.Message, 'Faulting application name: ([^,\s]+)')
  $m = [regex]::Match($_.Message, 'Faulting module name: ([^,\r\n]+)')
  [pscustomobject]@{ app = [string]$a.Groups[1].Value; module = [string]$m.Groups[1].Value; minutesAgo = [int]((Get-Date) - $_.TimeCreated).TotalMinutes }
})
$addins = @(Get-ChildItem -Path 'HKCU:\Software\Microsoft\Office\Outlook\Addins','HKLM:\SOFTWARE\Microsoft\Office\Outlook\Addins','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Office\Outlook\Addins' | ForEach-Object {
  $p = Get-ItemProperty -LiteralPath $_.PSPath
  [pscustomobject]@{ name = [string]$_.PSChildName; friendly = [string]$p.FriendlyName; loadBehavior = [int]$p.LoadBehavior }
})
$dataFiles = @(Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\Outlook\*') -Include *.ost,*.pst -File | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; sizeMb = [int]($_.Length / 1MB) } })
$drive = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':'))
$diskFreeGb = $null
if ($drive) { $diskFreeGb = [math]::Round($drive.Free / 1GB, 1) }
$reachable = $false
try {
  $tcp = New-Object System.Net.Sockets.TcpClient
  $iar = $tcp.BeginConnect('outlook.office365.com', 443, $null, $null)
  $reachable = ($iar.AsyncWaitHandle.WaitOne(4000) -and $tcp.Connected)
  $tcp.Close()
} catch { }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ install = $install; outlookPath = $outlookPath; processes = $procs; crashes = $crashes; addins = $addins; dataFiles = $dataFiles; diskFreeGb = $diskFreeGb; reachable = $reachable; admin = $admin } | ConvertTo-Json -Depth 5 -Compress
`);

export function parseOfficeFacts(stdout: string): OfficeFacts {
  const raw = extractJson(stdout);
  const i = raw.install as Record<string, unknown> | null | undefined;
  return {
    install: i
      ? { kind: i.kind === 'c2r' ? 'c2r' : 'msi', version: String(i.version ?? ''), platform: String(i.platform ?? ''), culture: String(i.culture ?? '') }
      : null,
    outlookPath: String(raw.outlookPath ?? '').replace(/^"|"$/g, ''),
    processes: asArray<Record<string, unknown>>(raw.processes).map((p) => ({ name: String(p.name ?? '').toUpperCase(), responding: p.responding !== false })),
    crashes: asArray<Record<string, unknown>>(raw.crashes).map((c) => ({
      app: String(c.app ?? '').toUpperCase(),
      module: String(c.module ?? '').trim(),
      minutesAgo: nonNegative(c.minutesAgo) ?? 0,
    })),
    addins: asArray<Record<string, unknown>>(raw.addins).map((a) => ({
      name: String(a.name ?? ''),
      friendly: String(a.friendly ?? ''),
      loadBehavior: typeof a.loadBehavior === 'number' ? a.loadBehavior : 0,
    })),
    dataFiles: asArray<Record<string, unknown>>(raw.dataFiles).map((f) => ({ name: String(f.name ?? ''), sizeMb: nonNegative(f.sizeMb) ?? 0 })),
    diskFreeGb: nonNegative(raw.diskFreeGb),
    microsoft365Reachable: typeof raw.reachable === 'boolean' ? raw.reachable : null,
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

const run = (runner: Parameters<typeof runScript>[0], script: string, timeoutMs = 60_000) => runScript(runner, script, timeoutMs);

function closeAppAction(name: string): Action {
  if (!(OFFICE_PROCESSES as readonly string[]).includes(name)) throw new Error(`Application Office inconnue : ${name}`);
  const label = LABELS[name]!;
  return {
    id: `close_office_app:${name}`,
    title: `Fermer ${label} (il ne répond plus)`,
    explanation: `${label} ne répond plus. Je le ferme de force. Les modifications non enregistrées dans ${label} seront perdues ; ${label === 'Outlook' ? 'vos courriers, eux, restent sur le serveur' : 'récupération automatique possible à la réouverture'}.`,
    requiresAdmin: false,
    verified: true,
    followUp: `${label} est fermé. Vous pouvez le rouvrir.`,
    run: (runner) => run(runner, guarded(`Stop-Process -Name ${name} -Force -ErrorAction SilentlyContinue\nWrite-Output 'OK'`)), // déjà fermé entre-temps : tant mieux
  };
}

function safeModeAction(outlookPath: string): Action {
  return {
    id: 'outlook_safe_mode',
    title: 'Ouvrir Outlook en mode sans échec',
    explanation:
      "Je lance Outlook sans ses compléments (mode sans échec). S'il fonctionne ainsi, un complément est probablement la cause : un technicien pourra alors le désactiver. Une fenêtre Outlook va s'ouvrir ; rien n'est modifié.",
    requiresAdmin: false,
    verified: true,
    followUp: "Outlook est ouvert en mode sans échec : regardez s'il fonctionne normalement, puis répondez à ma question.",
    run: (runner) => run(runner, guarded(`Start-Process -FilePath ${psQuote(outlookPath)} -ArgumentList '/safe'\nWrite-Output 'OK'`)),
  };
}

const PLATFORM = /^(x86|x64)$/;
const CULTURE = /^[a-z]{2,3}-[a-z]{2,4}$/i;

function repairAction(install: NonNullable<OfficeFacts['install']>): Action {
  const platform = PLATFORM.test(install.platform) ? install.platform : 'x64';
  const culture = CULTURE.test(install.culture) ? install.culture : 'fr-fr';
  return {
    id: 'repair_office',
    title: 'Réparer Microsoft Office (réparation rapide)',
    explanation:
      "Office plante à répétition. Je lance la réparation rapide de Microsoft : elle remet en état les fichiers du programme, sans toucher à vos documents ni à vos courriers. " +
      'Toutes les applications Office seront fermées : enregistrez votre travail avant d\'accepter. Une fenêtre Microsoft va s\'ouvrir.',
    requiresAdmin: true,
    verified: false, // le délai de fin de réparation dépend de Microsoft : à valider sur une vraie machine
    followUp: "Suivez la fenêtre de réparation Microsoft jusqu'au bout, puis rouvrez votre application avant de répondre.",
    run: (runner) =>
      run(
        runner,
        guarded(
          String.raw`$exe = Join-Path $env:ProgramFiles 'Common Files\Microsoft Shared\ClickToRun\OfficeClickToRun.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "Le programme de réparation d'Office est introuvable." }
` +
            `Start-Process -FilePath $exe -ArgumentList 'scenario=Repair platform=${platform} culture=${culture} forceappshutdown=True RepairType=QuickRepair DisplayLevel=True' -Wait\nWrite-Output 'OK'`,
        ),
        30 * 60_000,
      ),
  };
}

export interface OfficeDiagnoseOptions {
  /** Plantages plus anciens que cette durée (minutes) ignorés : ils précèdent une réparation déjà faite. */
  ignoreCrashesOlderThanMinutes?: number;
  roots?: string[];
}

const label = (app: string) => LABELS[app] ?? app;

/** Fonction pure : de l'état d'Office au diagnostic. */
export function diagnoseOffice(facts: OfficeFacts, options: OfficeDiagnoseOptions = {}): Diagnosis {
  const problems: string[] = [];
  const sentences: string[] = [];
  const advice: string[] = [];
  const actions: Action[] = [];
  let needsHuman = false;
  const roots = options.roots ?? defaultRoots();

  if (!facts.install) {
    return {
      summary: "Je ne trouve pas Microsoft Office installé sur cet ordinateur.",
      problems: ['office_missing'],
      actions: [],
      advice: ["S'il s'agit de la version en ligne (navigateur), un technicien ou l'assistant peut vous aider autrement."],
      healthy: false,
      needsHuman: true,
    };
  }

  // 1. Applications bloquées
  const hung = [...new Set(facts.processes.filter((p) => !p.responding).map((p) => p.name))].filter((n) => (OFFICE_PROCESSES as readonly string[]).includes(n));
  for (const name of hung) {
    problems.push(`office_not_responding:${name}`);
    sentences.push(`${label(name)} ne répond plus.`);
    actions.push(closeAppAction(name));
  }

  // 2. Plantages à répétition
  const maxAge = options.ignoreCrashesOlderThanMinutes ?? Infinity;
  const recent = facts.crashes.filter((c) => c.minutesAgo <= maxAge);
  const byApp = new Map<string, number>();
  for (const c of recent) byApp.set(c.app, (byApp.get(c.app) ?? 0) + 1);
  const crashing = [...byApp.entries()].filter(([, n]) => n >= CRASH_THRESHOLD);
  for (const [app, n] of crashing) {
    problems.push(`office_crashing:${app}`);
    sentences.push(`${label(app)} s'est arrêté ${n} fois ces 7 derniers jours.`);
  }
  if (crashing.length > 0) {
    if (facts.install.kind === 'c2r') actions.push(repairAction(facts.install));
    else advice.push("Cette version d'Office n'est pas « Démarrer en un clic » : sa réparation passe par le Panneau de configuration, un technicien peut s'en charger.");
  }

  // 3. Outlook : mode sans échec si ça plante, et compléments tiers à signaler
  const outlookCrashes = byApp.get('OUTLOOK') ?? 0;
  const thirdParty = facts.addins.filter((a) => a.loadBehavior === 3 && !/^(microsoft|ms\s|outlook|ucaddin|sharepoint|skype|onenote|teams)/i.test(a.friendly || a.name));
  if (outlookCrashes >= 1 && facts.outlookPath && isAllowedExecutable(facts.outlookPath, roots)) {
    if (!problems.includes('office_crashing:OUTLOOK')) {
      problems.push('outlook_unstable');
      sentences.push('Outlook s\'est déjà arrêté récemment.');
    }
    if (!hung.includes('OUTLOOK')) actions.push(safeModeAction(facts.outlookPath));
    if (thirdParty.length > 0) {
      advice.push(`Compléments Outlook installés : ${thirdParty.map((a) => a.friendly || a.name).join(', ')}. L'un d'eux est une cause fréquente de plantage.`);
    }
  }

  // 4. Constats que l'agent ne corrige pas lui-même
  const big = facts.dataFiles.filter((f) => f.sizeMb >= DATA_FILE_LARGE_MB);
  if (big.length > 0) {
    problems.push('outlook_data_large');
    sentences.push(`Le fichier de données Outlook « ${big[0]!.name} » est très volumineux (${Math.round(big[0]!.sizeMb / 1024)} Go).`);
    advice.push("Un fichier de courrier aussi gros ralentit Outlook : un technicien doit l'archiver ou le reconstruire (l'agent n'y touche pas, pour ne pas risquer vos courriers).");
    needsHuman = true;
  }
  if (facts.diskFreeGb !== null && facts.diskFreeGb < DISK_LOW_GB) {
    problems.push('disk_low');
    sentences.push(`Il ne reste que ${facts.diskFreeGb} Go sur le disque : Office a besoin d'espace pour fonctionner.`);
    advice.push("Libérez de l'espace (vider la corbeille, supprimer des fichiers inutiles) ou demandez à un technicien.");
  }
  if (facts.microsoft365Reachable === false) {
    problems.push('m365_unreachable');
    sentences.push("Les serveurs de messagerie Microsoft ne répondent pas depuis cet ordinateur.");
    advice.push("Vérifiez d'abord votre connexion Internet (demandez la compétence « Internet »).");
  }

  if (facts.admin === false && actions.some((a) => a.requiresAdmin)) {
    advice.push("L'agent n'est pas lancé en administrateur : la réparation d'Office échouera sans ce droit.");
  }

  const healthy = problems.length === 0;
  return {
    summary: healthy ? "Je ne vois rien d'anormal du côté d'Office." : sentences.join(' '),
    problems,
    actions,
    advice,
    healthy,
    needsHuman,
  };
}

export function officeSkill(roots: string[] = defaultRoots()): Skill {
  // Après une action, les plantages antérieurs ne comptent plus : seuls les nouveaux disent si c'est réglé.
  let actionDoneAt: number | null = null;
  return {
    id: 'office',
    title: 'Office / Outlook : plante, ne répond plus',
    verifyQuestion: 'Office (ou Outlook) fonctionne-t-il normalement maintenant ?',
    async diagnose(runner) {
      const facts = parseOfficeFacts(await readScript(runner, COLLECT_SCRIPT, "Le diagnostic d'Office", 90_000));
      const diagnosis = diagnoseOffice(facts, {
        roots,
        ignoreCrashesOlderThanMinutes: actionDoneAt === null ? undefined : Math.max(0, Math.floor((Date.now() - actionDoneAt) / 60_000)),
      });
      for (const action of diagnosis.actions) {
        const original = action.run;
        action.run = async (r) => {
          const result = await original(r);
          if (result.ok) actionDoneAt = Date.now();
          return result;
        };
      }
      return diagnosis;
    },
  };
}
