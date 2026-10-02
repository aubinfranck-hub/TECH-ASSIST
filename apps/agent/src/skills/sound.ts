import type { Action, ActionResult, CommandRunner, Diagnosis, Skill } from '../types.js';

/** États normalisés d'un périphérique audio (mêmes valeurs que DEVICE_STATE_* de l'API MMDevice). */
const ACTIVE = 1;
const DISABLED = 2;
const NOT_PRESENT = 4;
const UNPLUGGED = 8;

/**
 * Le registre (HKLM\...\MMDevices\Audio\...\DeviceState) n'utilise pas ces constantes :
 * actif = 0x1, désactivé = 0x10000001, débranché = 0x08000001, absent = 0x04000001.
 * On convertit vers les états normalisés, et on accepte aussi les valeurs de l'API (1, 2, 4, 8).
 */
export function normalizeDeviceState(raw: number): number {
  const value = raw >>> 0;
  const high = value >>> 24;
  if (high & 0x10) return DISABLED;
  if (high & 0x08) return UNPLUGGED;
  if (high & 0x04) return NOT_PRESENT;
  return value & 0xf;
}

const VOLUME_FLOOR = 0.05; // en dessous, on considère le son inaudible
const VOLUME_TARGET = 0.5;
const AUDIO_SERVICES = ['AudioEndpointBuilder', 'Audiosrv'] as const;

/** Identifiant de périphérique (GUID entre accolades) : validé avant d'entrer dans un script. */
const GUID_PATTERN = /^\{[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\}$/;

export interface AudioEndpoint {
  flow: 'Render' | 'Capture';
  guid: string;
  state: number;
  name: string;
}

export interface SoundFacts {
  services: { name: string; status: string }[];
  endpoints: AudioEndpoint[];
  /** Volume principal du périphérique par défaut (0 à 1), null si illisible. */
  volume: number | null;
  muted: boolean | null;
  admin: boolean | null;
}

/** Contrôle du volume / de la sourdine via l'API Core Audio de Windows (COM). */
const VOLUME_CS = String.raw`
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-46C0-A9D3-FA0C9E6B4A41")] class MMDeviceEnumeratorComObject { }
public class TaAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Volume {
    get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, Guid.Empty)); }
  }
  public static bool Mute {
    get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, Guid.Empty)); }
  }
}
`;

/**
 * Activation d'un périphérique désactivé (IPolicyConfig, interface Windows non
 * documentée mais utilisée par de nombreux outils). NON VALIDÉ sur une vraie
 * machine : voir `verified: false` sur l'action.
 */
const POLICY_CS = String.raw`
using System;
using System.Runtime.InteropServices;
[Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr f);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n, int d, IntPtr f);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a, IntPtr b);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string n, int d, IntPtr a, IntPtr b);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr a);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr m);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string n, IntPtr m);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string n, int fx, IntPtr k, IntPtr v);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string n, int fx, IntPtr k, IntPtr v);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string n, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string n, int visible);
}
[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigClient { }
public class TaPolicy {
  public static int SetVisible(string id, bool visible) {
    var p = (IPolicyConfig)new PolicyConfigClient();
    return p.SetEndpointVisibility(id, visible ? 1 : 0);
  }
}
`;

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

/** Lecture seule : services, périphériques (registre MMDevices), volume, sourdine, droits. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$svc = @(Get-Service -Name Audiosrv,AudioEndpointBuilder | ForEach-Object { [pscustomobject]@{ name = $_.Name; status = [string]$_.Status } })
$base = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio'
$eps = @(foreach ($flow in 'Render','Capture') {
  Get-ChildItem -Path "$base\$flow" | ForEach-Object {
    $state = (Get-ItemProperty -Path $_.PSPath).DeviceState
    $props = Get-ItemProperty -Path "$($_.PSPath)\Properties"
    $name = [string]$props.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
    if (-not $name) { $name = [string]$props.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6' }
    [pscustomobject]@{ flow = $flow; guid = $_.PSChildName; state = [int]$state; name = $name }
  }
})
$vol = $null
$mute = $null
$code = @'
${VOLUME_CS}
'@
try { Add-Type -TypeDefinition $code -ErrorAction Stop; $vol = [double][TaAudio]::Volume; $mute = [bool][TaAudio]::Mute } catch { }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ services = $svc; endpoints = $eps; volume = $vol; muted = $mute; admin = $admin } | ConvertTo-Json -Depth 4 -Compress
`);

function asArray<T>(value: unknown): T[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}

/** Lit la sortie JSON du script de collecte, de façon tolérante (objet seul, BOM, texte parasite). */
export function parseFacts(stdout: string): SoundFacts {
  const text = stdout.replace(/^﻿/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Réponse de diagnostic illisible');
  const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;

  const services = asArray<{ name?: unknown; status?: unknown }>(raw.services).map((s) => ({
    name: String(s.name ?? ''),
    status: String(s.status ?? ''),
  }));
  const endpoints = asArray<{ flow?: unknown; guid?: unknown; state?: unknown; name?: unknown }>(raw.endpoints)
    .filter((e) => (e.flow === 'Render' || e.flow === 'Capture') && GUID_PATTERN.test(String(e.guid ?? '')))
    .map((e) => ({
      flow: e.flow as 'Render' | 'Capture',
      guid: String(e.guid),
      state: normalizeDeviceState(Number(e.state ?? 0)),
      name: String(e.name ?? '').trim(),
    }));

  const volume = typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : null;
  return {
    services,
    endpoints,
    volume,
    muted: typeof raw.muted === 'boolean' ? raw.muted : null,
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

async function run(runner: CommandRunner, script: string): Promise<ActionResult> {
  try {
    const res = await runner.runPowerShell(script, { timeoutMs: 45_000 });
    if (res.exitCode === 0) return { ok: true, message: res.stdout.trim() || 'OK' };
    return { ok: false, message: res.stderr.trim() || `Échec (code ${res.exitCode})` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function startServicesAction(): Action {
  return {
    id: 'start_audio_services',
    title: 'Redémarrer le service audio de Windows',
    explanation: "Le service qui gère le son est arrêté. Je le démarre : cela ne modifie aucun de vos fichiers.",
    requiresAdmin: true,
    verified: true,
    run: (runner) =>
      run(
        runner,
        guarded(`Start-Service -Name ${AUDIO_SERVICES[0]}\nStart-Service -Name ${AUDIO_SERVICES[1]}\nWrite-Output 'OK'`),
      ),
  };
}

function enableEndpointAction(endpoint: AudioEndpoint): Action {
  if (!GUID_PATTERN.test(endpoint.guid)) throw new Error('Identifiant de périphérique invalide');
  const label = endpoint.name || 'le périphérique audio';
  return {
    id: 'enable_endpoint',
    title: `Réactiver « ${label} »`,
    explanation: `« ${label} » est désactivé dans Windows : aucun son ne peut en sortir. Je le réactive, comme le ferait le bouton « Autoriser » des paramètres du son.`,
    requiresAdmin: true,
    verified: false,
    run: (runner) =>
      run(
        runner,
        guarded(
          `$code = @'\n${POLICY_CS}\n'@\nAdd-Type -TypeDefinition $code\n` +
            `$hr = [TaPolicy]::SetVisible('{0.0.0.00000000}.${endpoint.guid}', $true)\n` +
            `if ($hr -ne 0) { throw ('Windows a refusé la réactivation (code 0x{0:X8})' -f $hr) }\nWrite-Output 'OK'`,
        ),
      ),
  };
}

function unmuteAction(): Action {
  return {
    id: 'unmute',
    title: 'Désactiver la sourdine',
    explanation: 'Le son de votre ordinateur est coupé (sourdine). Je le rétablis.',
    requiresAdmin: false,
    verified: true,
    run: (runner) => run(runner, guarded(`$code = @'\n${VOLUME_CS}\n'@\nAdd-Type -TypeDefinition $code\n[TaAudio]::Mute = $false\nWrite-Output 'OK'`)),
  };
}

function setVolumeAction(): Action {
  return {
    id: 'set_volume',
    title: `Remettre le volume à ${Math.round(VOLUME_TARGET * 100)} %`,
    explanation: 'Le volume est presque à zéro. Je le remonte à un niveau moyen ; vous pourrez le régler ensuite.',
    requiresAdmin: false,
    verified: true,
    run: (runner) =>
      run(
        runner,
        guarded(`$code = @'\n${VOLUME_CS}\n'@\nAdd-Type -TypeDefinition $code\n[TaAudio]::Volume = ${VOLUME_TARGET}\nWrite-Output 'OK'`),
      ),
  };
}

/** Transforme les faits observés en diagnostic et en actions proposées. Fonction pure, testable sans Windows. */
export function diagnoseSound(facts: SoundFacts): Diagnosis {
  const problems: string[] = [];
  const actions: Action[] = [];
  const advice: string[] = [];
  const sentences: string[] = [];
  let needsHuman = false;

  const stopped = facts.services.filter((s) => s.status !== 'Running');
  const missing = AUDIO_SERVICES.filter((name) => !facts.services.some((s) => s.name === name));
  if (missing.length > 0) {
    problems.push('audio_service_missing');
    sentences.push("Le service audio de Windows est introuvable : cela dépasse ce que je peux corriger seul.");
    needsHuman = true;
  } else if (stopped.length > 0) {
    problems.push('audio_service_stopped');
    sentences.push('Le service audio de Windows est arrêté.');
    actions.push(startServicesAction());
  }

  const render = facts.endpoints.filter((e) => e.flow === 'Render');
  const active = render.filter((e) => e.state === ACTIVE);
  const disabled = render.filter((e) => e.state === DISABLED);
  const unplugged = render.filter((e) => e.state === UNPLUGGED);
  const present = render.filter((e) => e.state !== NOT_PRESENT);

  if (active.length === 0) {
    if (disabled.length > 0) {
      problems.push('render_disabled');
      for (const endpoint of disabled) {
        sentences.push(`La sortie son « ${endpoint.name || 'inconnue'} » est désactivée dans Windows.`);
        actions.push(enableEndpointAction(endpoint));
      }
    } else if (unplugged.length > 0) {
      problems.push('render_unplugged');
      sentences.push('Aucune sortie son n\'est branchée.');
      advice.push('Branchez vos enceintes ou votre casque (ou reconnectez votre appareil Bluetooth), puis relancez.');
    } else if (present.length > 0) {
      // Des sorties existent mais leur état n'est pas un état connu : ne pas conclure « pas de pilote » à tort.
      problems.push('render_state_unknown');
      sentences.push("Je ne comprends pas l'état de votre sortie son : un technicien doit regarder.");
      needsHuman = true;
    } else if (missing.length === 0) {
      problems.push('no_render_device');
      sentences.push("Windows ne voit aucune carte son : le pilote audio est probablement absent ou en panne.");
      advice.push('Un technicien doit réinstaller le pilote audio de votre appareil.');
      needsHuman = true;
    }
  } else {
    if (facts.muted === true) {
      problems.push('muted');
      sentences.push('Le son est coupé (sourdine).');
      actions.push(unmuteAction());
    }
    if (facts.volume !== null && facts.volume < VOLUME_FLOOR) {
      problems.push('volume_low');
      sentences.push('Le volume est presque à zéro.');
      actions.push(setVolumeAction());
    }
  }

  if (facts.admin === false && actions.some((a) => a.requiresAdmin)) {
    advice.push("L'agent n'est pas lancé en administrateur : certaines corrections peuvent échouer.");
  }

  const healthy = problems.length === 0;
  return {
    summary: healthy ? 'Côté Windows, la sortie son semble correcte.' : sentences.join(' '),
    problems,
    actions,
    advice,
    healthy,
    needsHuman,
  };
}

export const soundSkill: Skill = {
  id: 'sound',
  title: 'Son : pas de son sur l\'ordinateur',
  async diagnose(runner) {
    const res = await runner.runPowerShell(COLLECT_SCRIPT, { timeoutMs: 45_000 });
    if (res.exitCode !== 0) throw new Error(res.stderr.trim() || 'Le diagnostic du son a échoué');
    return diagnoseSound(parseFacts(res.stdout));
  },
};
