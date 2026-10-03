import type { Action, Diagnosis, Skill } from '../types.js';
import { extractJson, guarded, nonNegative, readScript, runScript } from './common.js';

/**
 * Veille et verrouillage : l'ordinateur se met en veille et demande Ctrl+Alt+Suppr au réveil,
 * ou ne se réveille pas. Lecture seule : le verrouillage est un réglage de sécurité (souvent imposé
 * par l'entreprise), l'agent ne le modifie jamais ; il explique ce qui se passe et ce que le client peut régler.
 */

export interface PowerFacts {
  /** true = Ctrl+Alt+Suppr exigé pour ouvrir la session (réglage « DisableCAD » absent ou à 0). */
  ctrlAltDelRequired: boolean | null;
  /** Machine membre d'un domaine : la stratégie du domaine impose souvent ce comportement. */
  domainJoined: boolean | null;
  /** Délai de mise en veille sur secteur, en minutes (0 = jamais), null si illisible. */
  sleepMinutesAc: number | null;
  /** Délai d'extinction de l'écran sur secteur, en minutes (0 = jamais). */
  screenMinutesAc: number | null;
  /** Mot de passe demandé au réveil (« exiger la connexion »). */
  passwordOnWake: boolean | null;
  /** Dernière source de réveil connue (clavier, souris, bouton…), vide si inconnue. */
  lastWake: string;
  /** Démarrage rapide de Windows activé (cause fréquente de réveils ratés). */
  fastStartup: boolean | null;
  /** Veille moderne (S0) : réveils plus capricieux avec certains pilotes. */
  modernStandby: boolean | null;
  /** Nombre de fois où le pilote d'écran a planté (événement 4101) sur les 14 derniers jours. */
  displayDriverResets: number | null;
  /** Nom et ancienneté (en jours) du pilote de la carte graphique principale. */
  gpuName: string;
  gpuDriverAgeDays: number | null;
}

export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$sys = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$cad = $sys.DisableCAD
$cs = Get-CimInstance Win32_ComputerSystem
function Get-AcTimeout([string]$sub, [string]$setting) {
  # Indépendant de la langue de Windows : les deux dernières valeurs hexadécimales sont « secteur » puis « batterie ».
  $hex = @(powercfg /query SCHEME_CURRENT $sub $setting 2>$null | Select-String '0x[0-9a-fA-F]+' | ForEach-Object { $_.Matches[0].Value })
  if ($hex.Count -ge 2) { return [int]([Convert]::ToInt32($hex[$hex.Count - 2].Substring(2), 16) / 60) }
  return $null
}
$sleep = Get-AcTimeout 'SUB_SLEEP' 'STANDBYIDLE'
$screen = Get-AcTimeout 'SUB_VIDEO' 'VIDEOIDLE'
$wake = (powercfg /lastwake 2>$null | Out-String).Trim()
$hib = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power').HiberbootEnabled
$avail = (powercfg /a 2>$null | Out-String)
$s0 = [bool]($avail -match 'S0')
$resets = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Display'; Id = 4101; StartTime = (Get-Date).AddDays(-14) } -ErrorAction SilentlyContinue).Count
$gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic|Remote|Virtual' } | Select-Object -First 1
$gpuAge = $null
if ($gpu -and $gpu.DriverDate) { $gpuAge = [int]((Get-Date) - $gpu.DriverDate).TotalDays }
[pscustomobject]@{
  ctrlAltDelRequired = if ($null -eq $cad) { $null } else { [bool]($cad -eq 0) }
  domainJoined = [bool]$cs.PartOfDomain
  sleepMinutesAc = $sleep
  screenMinutesAc = $screen
  passwordOnWake = $null
  lastWake = $wake
  fastStartup = if ($null -eq $hib) { $null } else { [bool]($hib -eq 1) }
  modernStandby = $s0
  displayDriverResets = $resets
  gpuName = if ($gpu) { [string]$gpu.Name } else { '' }
  gpuDriverAgeDays = $gpuAge
} | ConvertTo-Json -Compress
`);

export function parsePowerFacts(stdout: string): PowerFacts {
  const raw = extractJson(stdout);
  const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
  return {
    ctrlAltDelRequired: flag(raw.ctrlAltDelRequired),
    domainJoined: flag(raw.domainJoined),
    sleepMinutesAc: nonNegative(raw.sleepMinutesAc),
    screenMinutesAc: nonNegative(raw.screenMinutesAc),
    passwordOnWake: flag(raw.passwordOnWake),
    lastWake: typeof raw.lastWake === 'string' ? raw.lastWake.slice(0, 300) : '',
    fastStartup: flag(raw.fastStartup),
    modernStandby: flag(raw.modernStandby),
    displayDriverResets: nonNegative(raw.displayDriverResets),
    gpuName: typeof raw.gpuName === 'string' ? raw.gpuName.replace(/[^\p{L}\p{N} ._()\-/]/gu, '').slice(0, 80) : '',
    gpuDriverAgeDays: nonNegative(raw.gpuDriverAgeDays),
  };
}

/** Désactive le démarrage rapide (cause classique de réveils ratés). Réversible, demande l'accord du client. */
const disableFastStartup = (): Action => ({
  id: 'disable_fast_startup',
  title: 'Désactiver le « démarrage rapide » de Windows',
  explanation:
    "Le démarrage rapide garde une partie de Windows en mémoire à l'extinction ; avec certains pilotes, il empêche l'ordinateur de se réveiller correctement. Je le désactive : l'ordinateur démarrera quelques secondes plus lentement, mais se réveillera de façon plus fiable. Vous pouvez le réactiver dans Panneau de configuration > Options d'alimentation > « Choisir l'action des boutons d'alimentation ».",
  requiresAdmin: true,
  verified: true,
  needsReboot: true,
  run: async (runner) => {
    const res = await runScript(runner, guarded(`powercfg /hibernate on | Out-Null\nSet-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name HiberbootEnabled -Value 0 -Type DWord\nWrite-Output 'OK'`));
    return res.ok ? { ok: true, message: 'Démarrage rapide désactivé', effect: 'Démarrage rapide : désactivé' } : res;
  },
});

export function diagnosePower(facts: PowerFacts): Diagnosis {
  const actions: Action[] = [];
  const advice: string[] = [];
  const problems: string[] = [];
  const parts: string[] = [];

  if (facts.ctrlAltDelRequired) {
    problems.push('ctrl_alt_del_required');
    parts.push('Windows exige Ctrl+Alt+Suppr avant d\'afficher l\'écran de connexion');
    advice.push(
      facts.domainJoined
        ? "Cet ordinateur est rattaché au réseau d'une entreprise : Ctrl+Alt+Suppr à la connexion est une règle de sécurité imposée par elle. Je ne la modifie pas ; seul votre responsable informatique peut la changer."
        : "Ctrl+Alt+Suppr est exigé à la connexion : c'est un réglage de sécurité de Windows. Je ne le modifie pas moi-même ; un technicien peut le désactiver avec votre accord (Stratégie de sécurité > Ouverture de session interactive).",
    );
  } else if (facts.ctrlAltDelRequired === false) {
    parts.push("Ctrl+Alt+Suppr n'est pas exigé par Windows à la connexion");
    advice.push("Si l'écran reste noir ou ne répond pas au réveil, le problème vient plutôt du pilote d'écran ou des réglages d'alimentation.");
  }

  if (facts.sleepMinutesAc !== null) {
    parts.push(facts.sleepMinutesAc === 0 ? 'mise en veille automatique désactivée' : `mise en veille après ${facts.sleepMinutesAc} min sur secteur`);
    if (facts.sleepMinutesAc > 0 && facts.sleepMinutesAc <= 15) {
      advice.push('Pour que l\'ordinateur se mette moins vite en veille : Paramètres > Système > Alimentation > « Écran, veille et mise en veille prolongée », puis choisissez un délai plus long.');
    }
  }

  // Écran qui ne se réveille pas / Ctrl+Alt+Suppr nécessaire : causes les plus fréquentes, de la plus probable à la moins probable.
  let wakeSuspect = false;
  if (facts.displayDriverResets !== null && facts.displayDriverResets > 0) {
    wakeSuspect = true;
    problems.push('display_driver_resets');
    parts.push(`le pilote de la carte graphique${facts.gpuName ? ` (${facts.gpuName})` : ''} a planté ${facts.displayDriverResets} fois ces 14 derniers jours`);
    advice.push("C'est la cause la plus probable d'un écran qui ne se réveille pas : le pilote de la carte graphique doit être mis à jour (ou réinstallé) depuis le site du fabricant de l'ordinateur ou de la carte. Un technicien peut le faire avec vous.");
  } else if (facts.gpuDriverAgeDays !== null && facts.gpuDriverAgeDays > 730) {
    wakeSuspect = true;
    problems.push('old_gpu_driver');
    parts.push(`le pilote de la carte graphique${facts.gpuName ? ` (${facts.gpuName})` : ''} date de plus de ${Math.floor(facts.gpuDriverAgeDays / 365)} ans`);
    advice.push('Un pilote graphique ancien provoque souvent des réveils ratés : une mise à jour est recommandée.');
  }
  if (facts.fastStartup) {
    wakeSuspect = true;
    problems.push('fast_startup');
    parts.push('le démarrage rapide de Windows est activé');
    actions.push(disableFastStartup());
  }
  if (facts.modernStandby) {
    parts.push('cet ordinateur utilise la « veille moderne »');
    advice.push("Avec la veille moderne, un pilote (carte graphique, Wi-Fi) mal à jour suffit à bloquer le réveil : mettez d'abord à jour le pilote de la carte graphique et les mises à jour Windows.");
  }

  const summary = parts.length
    ? `${parts.join(' ; ')}.`.replace(/^./, (c) => c.toUpperCase())
    : "Réglages de veille lus ; rien d'anormal dans les réglages. Si l'écran ne se réveille pas, la cause est le plus souvent le pilote de la carte graphique : un technicien peut le vérifier avec vous.";
  return { summary, problems, actions, advice, healthy: true, needsHuman: (problems.includes('ctrl_alt_del_required') && facts.domainJoined !== true) || wakeSuspect };
}

export function powerSkill(): Skill {
  return {
    id: 'power',
    title: 'Veille et verrouillage de session',
    verifyQuestion: 'Ces explications répondent-elles à votre question ?',
    async diagnose(runner) {
      return diagnosePower(parsePowerFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic de la veille')));
    },
  };
}
