import type { Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, isLocalHost, nonNegative, psQuote, readScript, safeLabel } from './common.js';
import { SERVER_HOST } from './serverCheck.js';

/**
 * Santé d'un serveur Windows, vue depuis ce PC : lecture seule, avec la session Windows de l'utilisateur
 * (aucun mot de passe demandé ni conservé). Si la session n'a pas les droits sur le serveur, la lecture échoue
 * et l'agent le dit : il ne tente jamais d'autres identifiants.
 */

export interface ServerHealthFacts {
  host: string;
  /** false : le serveur a refusé la lecture (droits) ou ne répond pas à la gestion à distance. */
  readable: boolean;
  uptimeDays: number | null;
  disks: { name: string; freePercent: number; freeGb: number }[];
  memoryUsedPercent: number | null;
  stoppedAutoServices: string[];
  errorsLast24h: number | null;
}

export function serverHealthScript(host: string): string {
  if (!SERVER_HOST.test(host) || !isLocalHost(host)) throw new Error('Nom ou adresse de serveur non valide (réseau local seulement)');
  return guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$target = ${psQuote(host)}
$opt = New-CimSessionOption -Protocol Dcom
$session = $null
try { $session = New-CimSession -ComputerName $target -OperationTimeoutSec 20 -ErrorAction Stop } catch { try { $session = New-CimSession -ComputerName $target -SessionOption $opt -OperationTimeoutSec 20 -ErrorAction Stop } catch { } }
if (-not $session) { [pscustomobject]@{ host = $target; readable = $false } | ConvertTo-Json -Compress; exit 0 }
$os = Get-CimInstance -CimSession $session -ClassName Win32_OperatingSystem
$disks = @(Get-CimInstance -CimSession $session -ClassName Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.Size -gt 0 } | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.DeviceID; freePercent = [int][math]::Round(100 * $_.FreeSpace / $_.Size); freeGb = [math]::Round($_.FreeSpace / 1GB, 1) } })
$svc = @(Get-CimInstance -CimSession $session -ClassName Win32_Service -Filter "StartMode='Auto' AND State<>'Running'" | Where-Object { $_.ExitCode -ne 0 -or $_.DelayedAutoStart -ne $true } | Select-Object -First 8 | ForEach-Object { [string]$_.DisplayName })
$errors = $null
try { $errors = @(Get-WinEvent -ComputerName $target -FilterHashtable @{ LogName = 'System'; Level = 1,2; StartTime = (Get-Date).AddHours(-24) } -MaxEvents 200 -ErrorAction Stop).Count } catch { }
[pscustomobject]@{
  host = $target; readable = $true
  uptimeDays = if ($os.LastBootUpTime) { [int]((Get-Date) - $os.LastBootUpTime).TotalDays } else { $null }
  disks = $disks
  memTotalKb = [double]$os.TotalVisibleMemorySize; memFreeKb = [double]$os.FreePhysicalMemory
  stoppedAutoServices = $svc; errorsLast24h = $errors
} | ConvertTo-Json -Depth 4 -Compress
Remove-CimSession $session
`);
}

export function parseServerHealth(stdout: string, host: string): ServerHealthFacts {
  const raw = extractJson(stdout);
  if (raw.readable !== true) return { host, readable: false, uptimeDays: null, disks: [], memoryUsedPercent: null, stoppedAutoServices: [], errorsLast24h: null };
  const total = nonNegative(raw.memTotalKb);
  const free = nonNegative(raw.memFreeKb);
  return {
    host,
    readable: true,
    uptimeDays: nonNegative(raw.uptimeDays),
    disks: asArray<Record<string, unknown>>(raw.disks)
      .map((d) => ({ name: safeLabel(d.name, 4), freePercent: nonNegative(d.freePercent) ?? 0, freeGb: nonNegative(d.freeGb) ?? 0 }))
      .filter((d) => /^[A-Z]:$/.test(d.name)),
    memoryUsedPercent: total && free !== null && free <= total ? Math.round(((total - free) / total) * 100) : null,
    stoppedAutoServices: asArray<unknown>(raw.stoppedAutoServices).map((s) => safeLabel(s, 50)).filter(Boolean).slice(0, 8),
    errorsLast24h: nonNegative(raw.errorsLast24h),
  };
}

export function diagnoseServerHealth(f: ServerHealthFacts): Diagnosis {
  const base = { actions: [], advice: [] as string[], problems: [] as string[] };
  if (!f.readable) {
    return {
      ...base,
      summary: `Je n'ai pas pu lire l'état du serveur « ${f.host} » depuis ce PC.`,
      problems: ['server_unreadable'],
      advice: ['Votre session Windows n\'a probablement pas le droit d\'administrer ce serveur, ou la gestion à distance est désactivée : à voir avec votre responsable informatique.'],
      healthy: false,
      needsHuman: true,
    };
  }
  const problems: string[] = [];
  const lines: string[] = [];
  for (const d of f.disks) {
    const low = d.freePercent < 10;
    if (low) problems.push(`disk_low:${d.name}`);
    lines.push(`${low ? '🔴' : d.freePercent < 20 ? '🟡' : '🟢'} Disque ${d.name} : ${d.freePercent} % libre (${String(d.freeGb).replace('.', ',')} Go)`);
  }
  if (f.memoryUsedPercent !== null) {
    const high = f.memoryUsedPercent >= 90;
    if (high) problems.push('memory_high');
    lines.push(`${high ? '🔴' : f.memoryUsedPercent >= 80 ? '🟡' : '🟢'} Mémoire utilisée : ${f.memoryUsedPercent} %`);
  }
  if (f.stoppedAutoServices.length > 0) {
    problems.push('services_stopped');
    lines.push(`🟠 Services automatiques arrêtés : ${f.stoppedAutoServices.join(', ')}`);
  }
  if (f.errorsLast24h !== null) {
    const many = f.errorsLast24h >= 20;
    if (many) problems.push('many_errors');
    lines.push(`${many ? '🟠' : '🟢'} Erreurs système (24 h) : ${f.errorsLast24h}`);
  }
  const advice: string[] = [];
  if (f.uptimeDays !== null && f.uptimeDays > 90) advice.push(`Le serveur n'a pas redémarré depuis ${f.uptimeDays} jours : des mises à jour sont probablement en attente.`);
  return {
    actions: [],
    summary: `Serveur « ${f.host} » (lecture seule)\n${lines.join('\n') || 'Aucune mesure disponible.'}`,
    problems,
    advice,
    healthy: problems.length === 0,
    // L'agent ne modifie jamais un serveur : tout problème trouvé passe à un humain.
    needsHuman: problems.length > 0,
  };
}

export function serverHealthSkill(host: string): Skill {
  const script = serverHealthScript(host);
  return {
    id: 'server-health',
    title: `Serveur « ${host} » : santé`,
    verifyQuestion: 'Ce constat vous suffit-il ?',
    async diagnose(runner) {
      return diagnoseServerHealth(parseServerHealth(await readScript(runner, script, 'La lecture du serveur', 120_000), host));
    },
  };
}
