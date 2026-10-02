import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, readScript, runScript, safeLabel, tracked } from './common.js';
import { openWindowsUpdateAction, withRestorePoint } from './safety.js';

/**
 * Pilotes : appareils en erreur (code Windows numérique), pilotes absents, appareil désactivé, anciens pilotes.
 * Un identifiant d'appareil lu sur la machine est revalidé avant d'entrer dans un script.
 */

export interface PnpProblem {
  name: string;
  deviceClass: string;
  id: string;
  /** ConfigManagerErrorCode : 22 désactivé, 28 pilote absent, 10/43 démarrage impossible… */
  code: number;
}

export interface DriverFacts {
  problems: PnpProblem[];
  /** Pilotes d'affichage / réseau / Bluetooth / son datés de plus de 3 ans. */
  oldDrivers: string[];
  admin: boolean | null;
}

/** Lecture seule : appareils présents avec un code d'erreur, vieux pilotes des classes courantes. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$problems = @(Get-CimInstance -ClassName Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -and $_.ConfigManagerErrorCode -ne 0 } | Select-Object -First 15 | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.Name; deviceClass = [string]$_.PNPClass; id = [string]$_.PNPDeviceID; code = [int]$_.ConfigManagerErrorCode }
})
$limit = (Get-Date).AddYears(-3)
$old = @(Get-CimInstance -ClassName Win32_PnPSignedDriver | Where-Object { $_.DriverDate -and $_.DriverDate -lt $limit -and @('DISPLAY', 'NET', 'BLUETOOTH', 'MEDIA') -contains $_.DeviceClass } | Select-Object -First 5 | ForEach-Object { [string]$_.DeviceName })
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ problems = $problems; oldDrivers = $old; admin = $admin } | ConvertTo-Json -Depth 4 -Compress
`);

export function parseDriverFacts(stdout: string): DriverFacts {
  const raw = extractJson(stdout);
  return {
    problems: asArray<Record<string, unknown>>(raw.problems)
      .map((p) => ({ name: safeLabel(p.name, 80) || 'Appareil', deviceClass: safeLabel(p.deviceClass, 30), id: String(p.id ?? ''), code: typeof p.code === 'number' && Number.isFinite(p.code) ? p.code : 0 }))
      .filter((p) => p.code !== 0),
    oldDrivers: asArray<unknown>(raw.oldDrivers).map((n) => safeLabel(n, 80)).filter(Boolean),
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

/** Identifiant matériel Windows (PCI\VEN_8086&DEV_1234\3&11583659&0&FA, USB\VID_…, {guid}…) : lettres, chiffres et _ & \ . # { } - uniquement. */
export const DEVICE_ID = /^[A-Za-z0-9_&\\.#{}-]{3,200}$/;

const enableDeviceAction = (p: PnpProblem): Action => ({
  id: 'enable_device',
  title: `Réactiver l'appareil « ${p.name} »`,
  explanation: `L'appareil « ${p.name} » est désactivé dans Windows. Je le réactive, comme un clic droit « Activer le périphérique » dans le Gestionnaire de périphériques.`,
  requiresAdmin: true,
  verified: true,
  run: (runner) => runScript(runner, guarded(`Enable-PnpDevice -InstanceId '${assertDeviceId(p.id)}' -Confirm:$false\nWrite-Output 'OK'`)),
});

const restartDeviceAction = (p: PnpProblem): Action =>
  withRestorePoint({
    id: 'restart_device',
    title: `Redémarrer l'appareil « ${p.name} »`,
    explanation: `L'appareil « ${p.name} » ne démarre pas correctement (code Windows ${p.code}). Je le désactive puis le réactive pour que Windows recharge son pilote. Il peut se couper quelques secondes.`,
    requiresAdmin: true,
    verified: true,
    run: (runner) =>
      runScript(
        runner,
        guarded(`$id = '${assertDeviceId(p.id)}'\ntry {\n  Disable-PnpDevice -InstanceId $id -Confirm:$false\n  Start-Sleep -Seconds 3\n} finally {\n  Enable-PnpDevice -InstanceId $id -Confirm:$false\n}\nStart-Sleep -Seconds 3\nWrite-Output 'OK'`),
      ),
  });

const rescanAction = (): Action => ({
  id: 'rescan_devices',
  title: 'Rechercher les appareils et pilotes manquants',
  explanation: "Je demande à Windows de relire tous les appareils branchés et de rechercher leurs pilotes. Rien n'est supprimé.",
  requiresAdmin: true,
  verified: true,
  run: (runner) => runScript(runner, guarded(`pnputil.exe /scan-devices | Out-Null\nif ($LASTEXITCODE -ne 0) { throw "La recherche d'appareils a échoué (code $LASTEXITCODE)." }\nWrite-Output 'OK'`), 3 * 60_000),
});

function assertDeviceId(id: string): string {
  if (!DEVICE_ID.test(id)) throw new Error("Identifiant d'appareil non reconnu");
  return id;
}

const CODE_DISABLED = 22;
const CODE_NO_DRIVER = [1, 3, 24, 28];

/** Fonction pure. */
export function diagnoseDrivers(facts: DriverFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const actions: Action[] = [];
  const problems: string[] = [];
  const sentences: string[] = [];
  const advice: string[] = [];
  let needWindowsUpdate = false;

  for (const p of facts.problems.slice(0, 5)) {
    if (!DEVICE_ID.test(p.id)) {
      advice.push(`L'appareil « ${p.name} » est en erreur : vérifiez-le dans le Gestionnaire de périphériques.`);
      continue;
    }
    if (p.code === CODE_DISABLED) {
      problems.push('device_disabled');
      sentences.push(`« ${p.name} » est désactivé.`);
      if (!tried.has('enable_device')) actions.push(enableDeviceAction(p));
    } else if (CODE_NO_DRIVER.includes(p.code)) {
      problems.push('driver_missing');
      sentences.push(`Le pilote de « ${p.name} » est absent.`);
      needWindowsUpdate = true;
    } else {
      problems.push('device_error');
      sentences.push(`« ${p.name} » ne fonctionne pas (code ${p.code}).`);
      if (!tried.has('restart_device')) actions.push(restartDeviceAction(p));
      else needWindowsUpdate = true;
    }
  }
  if (needWindowsUpdate) {
    if (!tried.has('rescan_devices')) actions.push(rescanAction());
    else if (!tried.has('open_windows_update')) actions.push(openWindowsUpdateAction());
  }
  if (facts.oldDrivers.length > 0) advice.push(`Pilotes anciens (plus de 3 ans) : ${facts.oldDrivers.join(', ')}. Une mise à jour peut améliorer la stabilité (Windows Update > Options avancées > Mises à jour facultatives).`);
  if (facts.admin === false && actions.some((a) => a.requiresAdmin)) advice.push("L'agent n'est pas lancé en administrateur : ces corrections échoueront sans ce droit.");

  const stuck = problems.length > 0 && actions.length === 0;
  return {
    summary: problems.length === 0 ? 'Aucun appareil en erreur.' : sentences.join(' '),
    problems,
    actions,
    advice,
    healthy: problems.length === 0,
    needsHuman: stuck,
  };
}

export function driversSkill(): Skill {
  const tried = new Set<string>();
  return {
    id: 'drivers',
    title: 'Pilotes : appareils en erreur',
    verifyQuestion: "L'appareil fonctionne-t-il maintenant ?",
    async diagnose(runner) {
      const d = diagnoseDrivers(parseDriverFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic des pilotes')), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
