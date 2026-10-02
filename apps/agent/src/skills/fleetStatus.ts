import { extractJson, guarded, nonNegative, readScript } from './common.js';
import type { CommandRunner } from '../types.js';

/**
 * Santé du poste envoyée à l'espace entreprise (vue de parc). Lecture seule, valeurs numériques ou booléennes
 * uniquement : aucun nom de fichier, aucun contenu, aucun texte Windows.
 */
export interface FleetHealth {
  diskFreePercent?: number;
  memoryUsedPercent?: number;
  antivirusOk?: boolean;
  osUpToDate?: boolean;
}

export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$sys = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$mp = Get-MpComputerStatus
$last = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
[pscustomobject]@{
  diskSizeBytes = [double]$sys.Size; diskFreeBytes = [double]$sys.FreeSpace
  memTotalKb = [double]$os.TotalVisibleMemorySize; memFreeKb = [double]$os.FreePhysicalMemory
  avEnabled = if ($mp) { [bool]$mp.AntivirusEnabled -and [bool]$mp.RealTimeProtectionEnabled } else { $null }
  lastPatchDaysAgo = if ($last) { [int]((Get-Date) - $last.InstalledOn).TotalDays } else { $null }
} | ConvertTo-Json -Compress
`);

/** Mises à jour : « à jour » si un correctif a été installé dans les 60 derniers jours. */
const PATCH_FRESH_DAYS = 60;

export function parseFleetHealth(stdout: string): FleetHealth {
  const raw = extractJson(stdout);
  const out: FleetHealth = {};
  const size = nonNegative(raw.diskSizeBytes);
  const free = nonNegative(raw.diskFreeBytes);
  if (size && free !== null && free <= size) out.diskFreePercent = Math.round((free / size) * 100);
  const total = nonNegative(raw.memTotalKb);
  const memFree = nonNegative(raw.memFreeKb);
  if (total && memFree !== null && memFree <= total) out.memoryUsedPercent = Math.round(((total - memFree) / total) * 100);
  if (typeof raw.avEnabled === 'boolean') out.antivirusOk = raw.avEnabled;
  const days = nonNegative(raw.lastPatchDaysAgo);
  if (days !== null) out.osUpToDate = days <= PATCH_FRESH_DAYS;
  return out;
}

export async function collectFleetHealth(runner: CommandRunner): Promise<FleetHealth> {
  return parseFleetHealth(await readScript(runner, COLLECT_SCRIPT, 'La santé du poste', 45_000));
}
