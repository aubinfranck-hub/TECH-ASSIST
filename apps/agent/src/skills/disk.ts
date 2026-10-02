import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, formatBytes, guarded, nonNegative, readScript, runScript, safeLabel, tracked } from './common.js';

/**
 * Disque : espace libre, santé des disques (SMART) et des volumes.
 * L'agent NE RÉPARE JAMAIS physiquement un disque : s'il en voit un défaillant, il prévient et passe la main.
 */

export interface DiskVolume {
  letter: string;
  sizeBytes: number;
  freeBytes: number;
  /** Healthy, Warning, Unhealthy… (énumération Windows). */
  health: string;
  system: boolean;
}

export interface PhysicalDisk {
  name: string;
  /** Healthy, Warning, Unhealthy. */
  health: string;
  /** SSD, HDD… */
  media: string;
  /** Windows annonce une panne prochaine (SMART). */
  predictFailure: boolean;
}

export interface DiskFacts {
  volumes: DiskVolume[];
  disks: PhysicalDisk[];
  admin: boolean | null;
}

/** Lecture seule : volumes fixes, disques physiques, prédiction de panne SMART. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$sys = $env:SystemDrive.Substring(0, 1)
$volumes = @(Get-Volume | Where-Object { $_.DriveType -eq 'Fixed' -and $_.DriveLetter } | ForEach-Object {
  [pscustomobject]@{ letter = [string]$_.DriveLetter; sizeBytes = [double]$_.Size; freeBytes = [double]$_.SizeRemaining; health = [string]$_.HealthStatus; system = ([string]$_.DriveLetter -eq $sys) }
})
$smart = @(Get-CimInstance -Namespace 'root\wmi' -ClassName MSStorageDriver_FailurePredictStatus | Where-Object { $_.PredictFailure })
$disks = @(Get-PhysicalDisk | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.FriendlyName; health = [string]$_.HealthStatus; media = [string]$_.MediaType; predictFailure = ($smart.Count -gt 0 -and [string]$_.HealthStatus -ne 'Healthy') }
})
if ($disks.Count -eq 0 -and $smart.Count -gt 0) { $disks = @([pscustomobject]@{ name = 'Disque'; health = 'Warning'; media = ''; predictFailure = $true }) }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ volumes = $volumes; disks = $disks; admin = $admin } | ConvertTo-Json -Depth 4 -Compress
`);

export function parseDiskFacts(stdout: string): DiskFacts {
  const raw = extractJson(stdout);
  return {
    volumes: asArray<Record<string, unknown>>(raw.volumes).map((v) => ({
      letter: String(v.letter ?? '').toUpperCase(),
      sizeBytes: nonNegative(v.sizeBytes) ?? 0,
      freeBytes: nonNegative(v.freeBytes) ?? 0,
      health: String(v.health ?? ''),
      system: v.system === true,
    })),
    disks: asArray<Record<string, unknown>>(raw.disks).map((d) => ({
      name: safeLabel(d.name, 80) || 'Disque',
      health: String(d.health ?? ''),
      media: String(d.media ?? ''),
      predictFailure: d.predictFailure === true,
    })),
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

const DRIVE_LETTER = /^[A-Z]$/;

/** Analyse en ligne du volume ; les erreurs trouvées sont corrigées par « SpotFix » (rapide, ne touche pas aux fichiers). */
function repairVolumeAction(volume: DiskVolume): Action {
  const letter = volume.letter;
  if (!DRIVE_LETTER.test(letter)) throw new Error('Lettre de lecteur invalide');
  return {
    id: 'repair_volume',
    title: `Vérifier et corriger les erreurs du lecteur ${letter}:`,
    explanation: `Windows signale des erreurs de fichiers sur le lecteur ${letter}:. Je lance l'analyse officielle de Windows (équivalent de CHKDSK) puis corrige uniquement les erreurs d'organisation des fichiers. Vos fichiers ne sont pas supprimés. ${volume.system ? "Pour le lecteur Windows, la correction peut se terminer au prochain redémarrage. " : ''}Cela peut durer plusieurs minutes. C'est une réparation du système de fichiers, pas du disque physique.`,
    requiresAdmin: true,
    verified: false, // le comportement de SpotFix sur le lecteur système dépend de la machine
    needsReboot: volume.system,
    run: (runner) =>
      runScript(
        runner,
        guarded(`$r = Repair-Volume -DriveLetter ${letter} -Scan\nif ([string]$r -ne 'NoErrorsFound') {\n  Repair-Volume -DriveLetter ${letter} -SpotFix | Out-Null\n}\nWrite-Output 'OK'`),
        30 * 60_000,
      ),
  };
}

/** Fonction pure. */
export function diagnoseDisk(facts: DiskFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const problems: string[] = [];
  const sentences: string[] = [];
  const advice: string[] = [];
  const actions: Action[] = [];
  let needsHuman = false;

  const failing = facts.disks.filter((d) => d.predictFailure || ['unhealthy', 'warning'].includes(d.health.toLowerCase()));
  if (failing.length > 0) {
    needsHuman = true;
    problems.push('disk_failing');
    sentences.push(`Le disque « ${failing[0]!.name} » donne des signes de défaillance (état : ${failing[0]!.health || 'inquiétant'}).`);
    advice.push('⚠️ Sauvegardez vos fichiers importants MAINTENANT (clé USB, disque externe ou cloud). Je ne tente aucune réparation sur un disque qui s\'abîme : cela pourrait aggraver la perte de données. Un technicien va prendre la suite.');
  }

  if (!needsHuman) {
    for (const v of facts.volumes) {
      if (['unhealthy', 'warning'].includes(v.health.toLowerCase()) && DRIVE_LETTER.test(v.letter)) {
        problems.push('volume_errors');
        sentences.push(`Windows signale des erreurs sur le lecteur ${v.letter}:.`);
        if (!tried.has('repair_volume')) actions.push(repairVolumeAction(v));
        else needsHuman = true;
        break;
      }
    }
  }

  for (const v of facts.volumes) {
    if (!v.sizeBytes) continue;
    const ratio = v.freeBytes / v.sizeBytes;
    if (ratio < 0.1) {
      sentences.push(`Le lecteur ${v.letter}: est presque plein : il reste ${formatBytes(v.freeBytes)} libres (${Math.round(ratio * 100)} %).`);
      advice.push(`Lecteur ${v.letter}: presque plein. Lancez « Nettoyage », puis regardez vos dossiers « Téléchargements » et « Vidéos » ou désinstallez les logiciels inutilisés. Un disque plein ralentit Windows.`);
    }
  }

  if (facts.admin === false && actions.length > 0) advice.push("L'agent n'est pas lancé en administrateur : cette réparation échouera sans ce droit.");

  const healthy = problems.length === 0;
  return {
    summary: healthy ? (sentences.length ? sentences.join(' ') : 'Disques en bonne santé, espace suffisant.') : sentences.join(' '),
    problems,
    actions,
    advice,
    healthy,
    needsHuman,
  };
}

export function diskSkill(): Skill {
  const tried = new Set<string>();
  return {
    id: 'disk',
    title: 'Disque : espace et santé',
    verifyQuestion: 'Le problème de disque est-il réglé ?',
    async diagnose(runner) {
      const d = diagnoseDisk(parseDiskFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic du disque')), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
