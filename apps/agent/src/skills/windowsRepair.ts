import type { Action, Diagnosis, Skill } from '../types.js';
import { extractJson, guarded, readScript, runScript, tracked } from './common.js';
import { withRestorePoint } from './safety.js';

/**
 * Fichiers système Windows : DISM (image Windows) puis SFC (fichiers protégés).
 * Aucun texte Windows n'est analysé : l'état de l'image est une énumération (Healthy, Repairable, NonRepairable)
 * et SFC est jugé sur son code de sortie.
 */

export type ImageState = 'Healthy' | 'Repairable' | 'NonRepairable' | 'Unknown';

export interface WindowsRepairFacts {
  imageState: ImageState;
  admin: boolean | null;
}

/**
 * Lecture seule. Exception documentée : `Repair-WindowsImage -CheckHealth` commence par « Repair » mais ne fait
 * que LIRE l'indicateur de corruption (aucune réparation sans -RestoreHealth) ; un test fige la liste des cmdlets.
 */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$state = 'Unknown'
if ($admin) {
  $r = Repair-WindowsImage -Online -CheckHealth
  if ($r) { $state = [string]$r.ImageHealthState }
}
[pscustomobject]@{ imageState = $state; admin = $admin } | ConvertTo-Json -Compress
`);

export function parseWindowsRepairFacts(stdout: string): WindowsRepairFacts {
  const raw = extractJson(stdout);
  const s = String(raw.imageState ?? '');
  const imageState: ImageState = s === 'Healthy' || s === 'Repairable' || s === 'NonRepairable' ? s : 'Unknown';
  return { imageState, admin: typeof raw.admin === 'boolean' ? raw.admin : null };
}

const dismAction = (): Action =>
  withRestorePoint({
    id: 'dism_restore_health',
    title: "Réparer l'image Windows (DISM)",
    explanation:
      "Windows signale que certains de ses composants sont abîmés. Je lance l'outil officiel de réparation (DISM), qui retélécharge les fichiers sains depuis Windows Update. Une connexion Internet est nécessaire ; cela peut durer de 10 à 40 minutes. Vos fichiers personnels ne sont pas touchés.",
    requiresAdmin: true,
    verified: true,
    run: (runner) => runScript(runner, guarded(`Repair-WindowsImage -Online -RestoreHealth | Out-Null\nWrite-Output 'OK'`), 60 * 60_000),
  });

const sfcAction = (): Action => ({
  id: 'sfc_scan',
  title: 'Vérifier et réparer les fichiers système (SFC)',
  explanation:
    "Je lance le vérificateur de fichiers système de Windows (SFC) : il compare chaque fichier protégé à sa copie saine et remplace ceux qui sont abîmés. Cela peut durer 10 à 30 minutes. Vos fichiers personnels ne sont pas touchés.",
  requiresAdmin: true,
  verified: false, // les codes de sortie de SFC ne sont pas contractuellement documentés
  run: (runner) =>
    runScript(runner, guarded(`sfc.exe /scannow | Out-Null\nif ($LASTEXITCODE -ne 0) { throw "SFC n'a pas pu réparer tous les fichiers système (code $LASTEXITCODE)." }\nWrite-Output 'OK'`), 60 * 60_000),
});

export interface WindowsRepairOptions {
  /** Lancer aussi SFC même si l'image est saine (demande explicite du client ou signes de corruption : plantages…). */
  runSfc?: boolean;
}

export function diagnoseWindowsRepair(facts: WindowsRepairFacts, options: WindowsRepairOptions = {}, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const advice: string[] = [];
  if (facts.imageState === 'NonRepairable') {
    return {
      summary: "Les composants de Windows sont trop abîmés pour être réparés automatiquement.",
      problems: ['image_non_repairable'],
      actions: [],
      advice: ['Sauvegardez vos fichiers. Un technicien va voir s\'il faut une réparation au démarrage ou une réinstallation de Windows.'],
      healthy: false,
      needsHuman: true,
    };
  }
  if (facts.imageState === 'Unknown') {
    if (facts.admin === false) advice.push("L'agent n'est pas lancé en administrateur : je ne peux pas vérifier l'état de Windows sans ce droit.");
    else advice.push("Je n'ai pas pu lire l'état de l'image Windows.");
    return { summary: "L'état des composants Windows n'a pas pu être lu.", problems: [], actions: [], advice, healthy: true, needsHuman: false };
  }

  const actions: Action[] = [];
  const problems: string[] = [];
  const sentences: string[] = [];
  if (facts.imageState === 'Repairable' && !tried.has('dism_restore_health')) {
    problems.push('image_repairable');
    sentences.push('Windows a détecté des composants abîmés (réparables).');
    actions.push(dismAction());
  }
  const wantSfc = options.runSfc === true || problems.length > 0;
  if (wantSfc && !tried.has('sfc_scan')) {
    if (problems.length === 0) {
      problems.push('sfc_requested');
      sentences.push("Vérification des fichiers système demandée.");
    }
    actions.push(sfcAction());
  }
  if (facts.imageState === 'Repairable' && tried.has('dism_restore_health') && tried.has('sfc_scan')) {
    return { summary: 'Des composants restent abîmés après la réparation.', problems: ['image_still_corrupt'], actions: [], advice: [], healthy: false, needsHuman: true };
  }
  return {
    summary: problems.length === 0 ? 'Les composants de Windows sont sains.' : sentences.join(' '),
    problems,
    actions,
    advice,
    healthy: problems.length === 0,
    needsHuman: false,
  };
}

export function windowsRepairSkill(options: WindowsRepairOptions = { runSfc: true }): Skill {
  const tried = new Set<string>();
  return {
    id: 'windows-repair',
    title: 'Windows : réparer les fichiers système',
    verifyQuestion: 'Windows fonctionne-t-il mieux ?',
    async diagnose(runner) {
      const d = diagnoseWindowsRepair(parseWindowsRepairFacts(await readScript(runner, COLLECT_SCRIPT, "Le diagnostic de l'image Windows", 10 * 60_000)), options, tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
