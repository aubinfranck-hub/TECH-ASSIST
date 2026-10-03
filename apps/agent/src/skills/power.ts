import type { Diagnosis, Skill } from '../types.js';
import { extractJson, guarded, nonNegative, readScript } from './common.js';

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
}

export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$sys = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$cad = $sys.DisableCAD
$cs = Get-CimInstance Win32_ComputerSystem
function Get-AcTimeout([string]$sub, [string]$setting) {
  $t = (powercfg /query SCHEME_CURRENT $sub $setting 2>$null | Select-String 'Current AC Power Setting Index|Index du param.tre de l.alimentation secteur actuel') | Select-Object -First 1
  if ($t -match '0x([0-9a-fA-F]+)') { return [int]([Convert]::ToInt32($Matches[1], 16) / 60) }
  return $null
}
$sleep = Get-AcTimeout 'SUB_SLEEP' 'STANDBYIDLE'
$screen = Get-AcTimeout 'SUB_VIDEO' 'VIDEOIDLE'
$wake = (powercfg /lastwake 2>$null | Out-String).Trim()
[pscustomobject]@{
  ctrlAltDelRequired = if ($null -eq $cad) { $null } else { [bool]($cad -eq 0) }
  domainJoined = [bool]$cs.PartOfDomain
  sleepMinutesAc = $sleep
  screenMinutesAc = $screen
  passwordOnWake = $null
  lastWake = $wake
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
  };
}

export function diagnosePower(facts: PowerFacts): Diagnosis {
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
  if (facts.lastWake) advice.push(`Dernier réveil enregistré par Windows : ${facts.lastWake.replace(/\s+/g, ' ')}`);

  const summary = parts.length ? `${parts.join(' ; ')}.` : "Réglages de veille lus ; rien d'anormal détecté.";
  return { summary, problems, actions: [], advice, healthy: true, needsHuman: problems.includes('ctrl_alt_del_required') && facts.domainJoined !== true };
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
