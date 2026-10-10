import { extractJson, guarded, psQuote, safeLabel } from '../skills/common.js';
import type { Args, ArgValue, Facts, FactType, Primitive, ToolId } from './manifest.js';
import { PRIMITIVES } from './manifest.js';

/**
 * Scripts PowerShell des opérations du catalogue (manifest.ts), écrits PAR NOUS.
 *
 * Aucune valeur n'y entre sans avoir été validée par `validateArgs` : noms limités à `[A-Za-z0-9_.-]`, listes fermées,
 * entiers bornés. Les textes passent en plus par `psQuote`. Rien de ce qu'écrit une IA n'est interprété comme du code.
 */

const str = (a: Args, key: string): string => String(a[key] ?? '');
const num = (a: Args, key: string): number => {
  const v: ArgValue | undefined = a[key];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`Paramètre « ${key} » invalide`);
  return v;
};

/** Script de lecture seule : il écrit un objet JSON de constats. */
export function observeScript(tool: ToolId, a: Args): string {
  switch (tool) {
    case 'service_status':
      return guarded(`$svc = Get-Service -Name ${psQuote(str(a, 'name'))} -ErrorAction SilentlyContinue
if (-not $svc) { @{ exists = $false } | ConvertTo-Json -Compress; exit 0 }
$cim = Get-CimInstance Win32_Service -Filter ("Name='" + $svc.Name + "'") -ErrorAction SilentlyContinue
$mode = ''
if ($cim) { $mode = [string]$cim.StartMode }
@{ exists = $true; status = [string]$svc.Status; startType = $mode } | ConvertTo-Json -Compress`);
    case 'process_info':
      return guarded(`$p = @(Get-Process -Name ${psQuote(str(a, 'name'))} -ErrorAction SilentlyContinue)
$mem = 0
if ($p.Count -gt 0) { $mem = [math]::Round((($p | Measure-Object -Property WorkingSet64 -Sum).Sum) / 1MB) }
@{ running = ($p.Count -gt 0); count = $p.Count; memoryMB = $mem } | ConvertTo-Json -Compress`);
    case 'event_errors': {
      const source = a.source === undefined ? '' : String(a.source);
      return guarded(`$since = (Get-Date).AddHours(-${num(a, 'hours')})
$events = @(Get-WinEvent -FilterHashtable @{ LogName = ${psQuote(str(a, 'log'))}; Level = 1,2; StartTime = $since } -MaxEvents 500 -ErrorAction SilentlyContinue)
$src = ${psQuote(source)}
if ($src) { $events = @($events | Where-Object { ($_.ProviderName -like ('*' + $src + '*')) -or ($_.Message -like ('*' + $src + '*')) }) }
@{ errors = $events.Count } | ConvertTo-Json -Compress`);
    }
    case 'disk_free':
      return guarded(`$d = Get-PSDrive -Name ${psQuote(str(a, 'drive'))} -PSProvider FileSystem -ErrorAction SilentlyContinue
if (-not $d -or $null -eq $d.Free) { @{} | ConvertTo-Json -Compress; exit 0 }
$total = $d.Used + $d.Free
@{ freeGB = [math]::Round($d.Free / 1GB, 1); freePercent = [math]::Round(100 * $d.Free / $total, 1) } | ConvertTo-Json -Compress`);
    case 'net_ping':
      return guarded(`$ok = Test-Connection -ComputerName ${psQuote(str(a, 'host'))} -Count 2 -Quiet -ErrorAction SilentlyContinue
@{ reachable = [bool]$ok } | ConvertTo-Json -Compress`);
    case 'net_port':
      return guarded(`$r = Test-NetConnection -ComputerName ${psQuote(str(a, 'host'))} -Port ${num(a, 'port')} -InformationLevel Quiet -WarningAction SilentlyContinue
@{ open = [bool]$r } | ConvertTo-Json -Compress`);
    case 'dns_resolve':
      return guarded(`$r = @(Resolve-DnsName -Name ${psQuote(str(a, 'name'))} -Type A -DnsOnly -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress })
@{ resolved = ($r.Count -gt 0) } | ConvertTo-Json -Compress`);
    case 'program_installed':
      return guarded(String.raw`$keys = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
$pattern = '*' + ${psQuote(str(a, 'name'))} + '*'
$m = @(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and ($_.DisplayName -like $pattern) } | Select-Object -First 1)
$version = ''
if ($m.Count -gt 0) { $version = [string]$m[0].DisplayVersion }
@{ installed = ($m.Count -gt 0); version = $version } | ConvertTo-Json -Compress`);
    case 'setting_read':
      return a.key === 'fast_startup'
        ? guarded(String.raw`$v = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled
if ($null -eq $v) { @{} | ConvertTo-Json -Compress; exit 0 }
@{ enabled = ($v -eq 1) } | ConvertTo-Json -Compress`)
        : guarded(String.raw`$v = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name ProxyEnable -ErrorAction SilentlyContinue).ProxyEnable
@{ enabled = ($v -eq 1) } | ConvertTo-Json -Compress`);
    default:
      throw new Error(`« ${tool} » n'est pas une opération de lecture`);
  }
}

const SERVICE_STATUS: Record<string, string> = { running: 'running', stopped: 'stopped', paused: 'paused' };
const START_TYPE: Record<string, string> = { auto: 'automatic', automatic: 'automatic', manual: 'manual', disabled: 'disabled', boot: 'boot', system: 'system' };

/**
 * Constats lus dans la sortie d'un script de lecture. Seuls les constats annoncés par le catalogue sont retenus, et du bon type :
 * tout le reste est ignoré (la sortie vient de la machine, mais on ne lui fait pas confiance pour autant).
 */
export function parseFacts(tool: ToolId, stdout: string): Facts {
  const primitive: Primitive = PRIMITIVES[tool];
  const declared: Record<string, FactType> = primitive.facts ?? {};
  const raw = extractJson(stdout);
  const out: Facts = {};
  for (const [name, type] of Object.entries(declared)) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const value = raw[name];
    if (type === 'boolean' && typeof value === 'boolean') out[name] = value;
    else if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) out[name] = value;
    else if (type === 'string' && typeof value === 'string') out[name] = safeLabel(value, 40).toLowerCase();
  }
  if (tool === 'service_status') {
    if (typeof out.status === 'string') out.status = /pending/.test(out.status) ? 'pending' : (SERVICE_STATUS[out.status] ?? out.status);
    if (typeof out.startType === 'string') out.startType = START_TYPE[out.startType] ?? out.startType;
  }
  return out;
}

export interface ActScript {
  script: string;
  timeoutMs: number;
}

/** Script d'une modification. Les durées reprennent ce qui est annoncé au client (voir tasks.ts). */
export function actScript(tool: ToolId, a: Args): ActScript {
  switch (tool) {
    case 'service_start': {
      const name = psQuote(str(a, 'name'));
      return {
        timeoutMs: 60_000,
        script: guarded(`$name = ${name}
$svc = Get-Service -Name $name -ErrorAction Stop
if ($svc.Status -eq 'Running') { Write-Output 'OK'; exit 0 }
Start-Service -Name $name -ErrorAction Stop
(Get-Service -Name $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(25))
if ((Get-Service -Name $name).Status -ne 'Running') { throw ('Le service « ' + $name + " » n'a pas démarré.") }
Write-Output 'OK'`),
      };
    }
    case 'service_restart': {
      const name = psQuote(str(a, 'name'));
      return {
        timeoutMs: 90_000,
        script: guarded(`$name = ${name}
$null = Get-Service -Name $name -ErrorAction Stop
Restart-Service -Name $name -Force -ErrorAction Stop
(Get-Service -Name $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
if ((Get-Service -Name $name).Status -ne 'Running') { throw ('Le service « ' + $name + " » ne s'est pas relancé.") }
Write-Output 'OK'`),
      };
    }
    case 'service_set_startup': {
      const mode = a.mode === 'Automatic' ? 'Automatic' : 'Manual'; // liste fermée : jamais Disabled
      return { timeoutMs: 30_000, script: guarded(`Set-Service -Name ${psQuote(str(a, 'name'))} -StartupType ${mode} -ErrorAction Stop\nWrite-Output 'OK'`) };
    }
    case 'process_stop': {
      const name = psQuote(str(a, 'name'));
      return {
        timeoutMs: 30_000,
        script: guarded(`$name = ${name}
$p = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
if ($p.Count -eq 0) { Write-Output 'Déjà fermé'; exit 0 }
$p | Stop-Process -Force -ErrorAction Stop
Start-Sleep -Seconds 1
if (@(Get-Process -Name $name -ErrorAction SilentlyContinue).Count -gt 0) { throw ('Le programme « ' + $name + " » est toujours ouvert.") }
Write-Output ('{0} fenêtre(s) ou processus fermé(s)' -f $p.Count)`),
      };
    }
    case 'explorer_restart':
      return { timeoutMs: 40_000, script: guarded(EXPLORER_RESTART) };
    case 'explorer_caches':
      return {
        timeoutMs: 60_000,
        script: guarded(String.raw`$dir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer'
Get-Process -Name explorer -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$files = @(Get-ChildItem -Path (Join-Path $dir '*') -Include 'thumbcache_*.db', 'iconcache_*.db' -File -Force -ErrorAction SilentlyContinue)
$old = Join-Path $env:LOCALAPPDATA 'IconCache.db'
if (Test-Path -LiteralPath $old) { $files += Get-Item -LiteralPath $old -Force }
$removed = 0
foreach ($f in $files) { try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop; $removed++ } catch { } }
${EXPLORER_BACK}
Write-Output ('{0} fichier(s) supprimé(s)' -f $removed)`),
      };
    case 'net_reset':
      return netReset(String(a.what));
    case 'setting_set':
      return settingSet(String(a.key), String(a.value));
    default:
      throw new Error(`« ${tool} » n'est pas une opération de modification`);
  }
}

/** Windows relance l'explorateur tout seul quand il est fermé ; on laisse quelques secondes avant de le lancer nous-mêmes. */
const EXPLORER_BACK = `$back = $false
for ($i = 0; $i -lt 8; $i++) { if (Get-Process -Name explorer -ErrorAction SilentlyContinue) { $back = $true; break }; Start-Sleep -Seconds 1 }
if (-not $back) { Start-Process -FilePath 'explorer.exe'; Start-Sleep -Seconds 2 }
if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { throw "L'explorateur Windows ne s'est pas relancé." }`;

const EXPLORER_RESTART = `Get-Process -Name explorer -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
${EXPLORER_BACK}
Write-Output 'OK'`;

function netReset(what: string): ActScript {
  if (what === 'flush_dns') return { timeoutMs: 30_000, script: guarded(`Clear-DnsClientCache\nWrite-Output 'OK'`) };
  if (what === 'renew_ip') {
    return {
      timeoutMs: 90_000,
      script: guarded(`ipconfig.exe /release | Out-Null
Start-Sleep -Seconds 2
ipconfig.exe /renew | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Le routeur n'a pas donné de nouvelle adresse." }
Write-Output 'OK'`),
    };
  }
  if (what === 'winsock') {
    return {
      timeoutMs: 90_000,
      script: guarded(`netsh.exe winsock reset | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Windows a refusé la réinitialisation du réseau.' }
Write-Output 'OK'`),
    };
  }
  throw new Error('Réinitialisation réseau inconnue');
}

function settingSet(key: string, value: string): ActScript {
  if (key === 'fast_startup') {
    const v = value === 'off' ? 0 : 1;
    return {
      timeoutMs: 30_000,
      script: guarded(String.raw`Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -Value ${v} -Type DWord -ErrorAction Stop
$now = (Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled).HiberbootEnabled
if ($now -ne ${v}) { throw "Le réglage n'a pas été enregistré." }
Write-Output 'OK'`),
    };
  }
  if (key === 'proxy' && value === 'off') {
    return {
      timeoutMs: 30_000,
      script: guarded(String.raw`$k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
Set-ItemProperty -Path $k -Name ProxyEnable -Value 0 -Type DWord -ErrorAction Stop
if ((Get-ItemProperty -Path $k -Name ProxyEnable).ProxyEnable -ne 0) { throw "Le réglage n'a pas été enregistré." }
Write-Output 'OK'`),
    };
  }
  throw new Error('Réglage non permis');
}

/** Identifiant d'action lisible par le suivi des tâches (durées habituelles : voir tasks.ts). */
export function actionIdFor(tool: ToolId, a: Args, stepId: string): string {
  if (tool === 'net_reset') return `${a.what === 'winsock' ? 'reset_network_stack' : String(a.what)}:${stepId}`;
  if (tool === 'setting_set' && a.key === 'proxy') return `disable_proxy:${stepId}`;
  return `${tool}:${stepId}`;
}

