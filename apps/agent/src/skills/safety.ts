import type { Action } from '../types.js';
import { guarded, runScript } from './common.js';

/** Actions de sécurité communes : point de restauration avant une modification sensible, redémarrage, simple confirmation. */

export function restorePointAction(): Action {
  return {
    id: 'restore_point',
    title: 'Créer un point de restauration Windows',
    explanation:
      "Avant de modifier Windows, je crée un point de restauration : si quelque chose se passe mal, Windows peut revenir à l'état d'avant (Panneau de configuration > Récupération). Windows en garde un seul par 24 heures : s'il en existe déjà un récent, il est conservé. Vos fichiers ne sont pas touchés.",
    requiresAdmin: true,
    verified: false, // la limite d'un point par 24 h et la protection du système dépendent de chaque machine
    run: (runner) =>
      runScript(
        runner,
        guarded(String.raw`$drive = $env:SystemDrive + '\'
Enable-ComputerRestore -Drive $drive
Checkpoint-Computer -Description 'Tech Assist avant reparation' -RestorePointType 'MODIFY_SETTINGS' -WarningAction SilentlyContinue
$points = @(Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Sort-Object SequenceNumber)
if ($points.Count -eq 0) { throw "Windows n'a créé aucun point de restauration : la protection du système est peut-être désactivée." }
$when = [Management.ManagementDateTimeConverter]::ToDateTime($points[$points.Count - 1].CreationTime)
if (((Get-Date) - $when).TotalHours -gt 24) { throw "Windows n'a pas créé de nouveau point de restauration." }
Write-Output 'OK'`),
        5 * 60_000,
      ),
  };
}

/** Rend une action « sensible » : un point de restauration est créé d'abord (après l'accord du client). */
export function withRestorePoint(action: Action): Action {
  return {
    ...action,
    risk: 'sensitive',
    prepare: restorePointAction(),
    explanation: `${action.explanation} Un point de restauration Windows sera créé juste avant, pour pouvoir revenir en arrière.`,
  };
}

export function rebootAction(): Action {
  return {
    id: 'reboot',
    title: "Redémarrer l'ordinateur",
    explanation:
      "Ces corrections ne sont actives qu'après un redémarrage. Windows redémarrera dans 60 secondes : enregistrez votre travail maintenant. Pour annuler pendant ce délai : touches Windows + R, tapez « shutdown /a », puis Entrée.",
    requiresAdmin: false,
    verified: true,
    run: (runner) => runScript(runner, guarded(`shutdown.exe /r /t 60 /c "Tech Assist : redémarrage pour terminer les corrections"\nif ($LASTEXITCODE -ne 0) { throw 'Windows a refusé le redémarrage.' }\nWrite-Output 'OK'`)),
  };
}

/** Ouvre la page Windows Update des Paramètres : le client lance lui-même la recherche (mises à jour, pilotes facultatifs). Ne modifie rien. */
export function openWindowsUpdateAction(): Action {
  return {
    id: 'open_windows_update',
    title: 'Ouvrir Windows Update',
    explanation:
      "J'ouvre la page « Windows Update » des Paramètres. Vous y cliquez sur « Rechercher les mises à jour » (et, pour les pilotes, sur « Options avancées > Mises à jour facultatives »). Rien n'est installé sans vous.",
    requiresAdmin: false,
    verified: true,
    followUp: 'La page Windows Update est ouverte : cliquez sur « Rechercher les mises à jour », laissez Windows télécharger, puis revenez ici.',
    run: (runner) => runScript(runner, guarded(`Start-Process 'ms-settings:windowsupdate'\nWrite-Output 'OK'`)),
  };
}

/** Question simple à poser au client avec les boutons d'autorisation ; ne s'exécute jamais (run n'est pas appelée). */
export function confirmOnly(title: string, explanation: string, requiresAdmin = false): Action {
  return {
    id: 'confirm_only',
    title,
    explanation,
    requiresAdmin,
    verified: true,
    run: async () => ({ ok: true, message: 'Confirmation seule' }),
  };
}
