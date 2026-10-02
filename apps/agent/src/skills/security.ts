import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, nonNegative, readScript, runScript, safeLabel, tracked } from './common.js';
import { openWindowsUpdateAction } from './safety.js';

/**
 * Sécurité de base : Microsoft Defender, pare-feu, ancienneté des mises à jour.
 * L'agent ne fait que RÉACTIVER une protection ; il n'en désactive jamais et ne touche pas aux exclusions.
 */

export const FIREWALL_PROFILES = ['Domain', 'Private', 'Public'] as const;

export interface SecurityFacts {
  defender: { serviceEnabled: boolean; realTime: boolean; signatureAgeDays: number | null } | null;
  /** Antivirus autres que Defender (Defender se met alors volontairement en retrait). */
  otherAntivirus: string[];
  firewall: { name: string; enabled: boolean }[];
  daysSinceUpdate: number | null;
  admin: boolean | null;
}

/** Lecture seule : état de Defender, antivirus tiers, pare-feu par profil, date de la dernière mise à jour installée. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$mp = Get-MpComputerStatus
$defender = $null
if ($mp) { $defender = [pscustomobject]@{ serviceEnabled = [bool]$mp.AMServiceEnabled; realTime = [bool]$mp.RealTimeProtectionEnabled; signatureAgeDays = $mp.AntivirusSignatureAge } }
$av = @(Get-CimInstance -Namespace 'root\SecurityCenter2' -ClassName AntiVirusProduct | ForEach-Object { [string]$_.displayName } | Where-Object { $_ -notmatch 'Defender' })
$fw = @(Get-NetFirewallProfile | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; enabled = ([string]$_.Enabled -eq 'True') } })
$last = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
$days = $null
if ($last) { $days = [int]((Get-Date) - $last.InstalledOn).TotalDays }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ defender = $defender; otherAntivirus = $av; firewall = $fw; daysSinceUpdate = $days; admin = $admin } | ConvertTo-Json -Depth 4 -Compress
`);

export function parseSecurityFacts(stdout: string): SecurityFacts {
  const raw = extractJson(stdout);
  const d = raw.defender && typeof raw.defender === 'object' ? (raw.defender as Record<string, unknown>) : null;
  return {
    defender: d ? { serviceEnabled: d.serviceEnabled === true, realTime: d.realTime === true, signatureAgeDays: nonNegative(d.signatureAgeDays) } : null,
    otherAntivirus: asArray<unknown>(raw.otherAntivirus).map((n) => safeLabel(n, 60)).filter(Boolean),
    firewall: asArray<Record<string, unknown>>(raw.firewall).map((f) => ({ name: String(f.name ?? ''), enabled: f.enabled === true })),
    daysSinceUpdate: nonNegative(raw.daysSinceUpdate),
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

const enableRealTime = (): Action => ({
  id: 'enable_realtime',
  title: 'Réactiver la protection en temps réel de Defender',
  explanation: "La protection en temps réel de Microsoft Defender est éteinte : un virus pourrait s'installer sans alerte. Je la rallume. Si Windows la bloque (protection contre les falsifications), je vous le dirai. Aucune exclusion n'est modifiée.",
  requiresAdmin: true,
  verified: true,
  run: (runner) => runScript(runner, guarded(`Set-MpPreference -DisableRealtimeMonitoring $false\nif ((Get-MpComputerStatus).RealTimeProtectionEnabled -ne $true) { throw "Windows a refusé de réactiver la protection en temps réel." }\nWrite-Output 'OK'`)),
});

const updateSignatures = (): Action => ({
  id: 'update_signatures',
  title: 'Mettre à jour la base de virus de Defender',
  explanation: "La liste des virus connus de Defender n'est plus à jour. Je la télécharge depuis Microsoft (connexion Internet nécessaire). Aucun fichier n'est touché.",
  requiresAdmin: true,
  verified: true,
  run: (runner) => runScript(runner, guarded(`Update-MpSignature\nWrite-Output 'OK'`), 5 * 60_000),
});

const enableFirewall = (profiles: string[]): Action => {
  const safe = profiles.filter((p): p is (typeof FIREWALL_PROFILES)[number] => (FIREWALL_PROFILES as readonly string[]).includes(p));
  return {
    id: 'enable_firewall',
    title: 'Réactiver le pare-feu Windows',
    explanation: `Le pare-feu Windows est éteint pour : ${safe.join(', ')}. Je le rallume : il bloque les connexions entrantes non sollicitées. Cela peut interrompre un programme qui comptait sur son absence ; dites-le moi si c'est le cas.`,
    requiresAdmin: true,
    verified: true,
    run: (runner) => runScript(runner, guarded(`Set-NetFirewallProfile -Profile ${safe.join(',')} -Enabled True\nWrite-Output 'OK'`)),
  };
};

export const STALE_SIGNATURES_DAYS = 7;
export const STALE_UPDATES_DAYS = 90;

export function diagnoseSecurity(facts: SecurityFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const problems: string[] = [];
  const sentences: string[] = [];
  const advice: string[] = [];
  const actions: Action[] = [];
  const thirdParty = facts.otherAntivirus.length > 0;

  if (thirdParty) {
    advice.push(`Antivirus utilisé : ${facts.otherAntivirus.join(', ')}. Defender reste volontairement en retrait ; vérifiez que cet antivirus est à jour et sous licence.`);
  } else if (facts.defender === null) {
    problems.push('no_antivirus');
    sentences.push("Je ne trouve aucun antivirus actif.");
    advice.push("Activez Sécurité Windows (Paramètres > Confidentialité et sécurité > Sécurité Windows) ou installez un antivirus reconnu.");
  } else {
    if (!facts.defender.serviceEnabled) {
      problems.push('defender_off');
      sentences.push("Le moteur de Defender est arrêté.");
      advice.push("Ouvrez « Sécurité Windows » : il propose de le réactiver. Un technicien peut vous aider si le bouton est absent.");
    } else if (!facts.defender.realTime && !tried.has('enable_realtime')) {
      problems.push('realtime_off');
      sentences.push('La protection en temps réel est désactivée.');
      actions.push(enableRealTime());
    } else if (!facts.defender.realTime) {
      problems.push('realtime_off');
      sentences.push('La protection en temps réel reste désactivée.');
    }
    if (facts.defender.serviceEnabled && (facts.defender.signatureAgeDays ?? 0) > STALE_SIGNATURES_DAYS && !tried.has('update_signatures')) {
      problems.push('signatures_old');
      sentences.push(`La base de virus a ${facts.defender.signatureAgeDays} jours.`);
      actions.push(updateSignatures());
    }
  }

  const off = facts.firewall.filter((f) => !f.enabled && (FIREWALL_PROFILES as readonly string[]).includes(f.name)).map((f) => f.name);
  if (off.length > 0 && !tried.has('enable_firewall')) {
    problems.push('firewall_off');
    sentences.push(`Le pare-feu est désactivé (${off.join(', ')}).`);
    actions.push(enableFirewall(off));
  } else if (off.length > 0) {
    problems.push('firewall_off');
    sentences.push('Le pare-feu reste désactivé.');
  }

  if (facts.daysSinceUpdate !== null && facts.daysSinceUpdate > STALE_UPDATES_DAYS && !tried.has('open_windows_update')) {
    problems.push('updates_old');
    sentences.push(`Aucune mise à jour Windows installée depuis ${facts.daysSinceUpdate} jours.`);
    actions.push(openWindowsUpdateAction());
  }
  if (facts.admin === false && actions.some((a) => a.requiresAdmin)) advice.push("L'agent n'est pas lancé en administrateur : ces corrections échoueront sans ce droit.");

  const stuck = problems.length > 0 && actions.length === 0 && advice.length === 0;
  return {
    summary: problems.length === 0 ? 'Sécurité de base en ordre (antivirus, pare-feu, mises à jour).' : sentences.join(' '),
    problems,
    actions,
    advice,
    healthy: problems.length === 0,
    needsHuman: stuck,
  };
}

export function securitySkill(): Skill {
  const tried = new Set<string>();
  return {
    id: 'security',
    title: 'Sécurité : antivirus, pare-feu, mises à jour',
    verifyQuestion: 'La sécurité de votre ordinateur vous paraît-elle en ordre ?',
    async diagnose(runner) {
      const d = diagnoseSecurity(parseSecurityFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic de sécurité')), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
