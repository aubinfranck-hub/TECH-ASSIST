import type { Action, Diagnosis, Skill } from '../types.js';
import { extractJson, guarded, nonNegative, readScript, tracked } from './common.js';
import { openWindowsUpdateAction } from './safety.js';

/**
 * Plantages et redémarrages inattendus (30 derniers jours). On compte les événements Windows par numéro
 * (41 coupure/redémarrage inattendu, 1001 écran bleu, 6008 arrêt imprévu) : jamais de texte analysé.
 */

export interface CrashFacts {
  kernelPower: number;
  bugchecks: number;
  unexpectedShutdowns: number;
  dumpFiles: number;
}

/** Lecture seule : nombre d'événements de plantage sur 30 jours et de fichiers d'analyse (minidump). */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$since = (Get-Date).AddDays(-30)
$events = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41, 1001, 6008; StartTime = $since })
$dumps = @(Get-ChildItem -Path (Join-Path $env:windir 'Minidump') -Filter '*.dmp' -File)
[pscustomobject]@{
  kernelPower = @($events | Where-Object { $_.Id -eq 41 }).Count
  bugchecks = @($events | Where-Object { $_.Id -eq 1001 }).Count
  unexpectedShutdowns = @($events | Where-Object { $_.Id -eq 6008 }).Count
  dumpFiles = $dumps.Count
} | ConvertTo-Json -Compress
`);

export function parseCrashFacts(stdout: string): CrashFacts {
  const raw = extractJson(stdout);
  return {
    kernelPower: nonNegative(raw.kernelPower) ?? 0,
    bugchecks: nonNegative(raw.bugchecks) ?? 0,
    unexpectedShutdowns: nonNegative(raw.unexpectedShutdowns) ?? 0,
    dumpFiles: nonNegative(raw.dumpFiles) ?? 0,
  };
}

export const crashCount = (f: CrashFacts) => Math.max(f.kernelPower, f.bugchecks, f.unexpectedShutdowns);

/** 5 plantages ou plus en un mois : cause matérielle probable (mémoire, disque, chaleur, alimentation). */
export const HARDWARE_SUSPECT = 5;

export function diagnoseCrashes(facts: CrashFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const n = crashCount(facts);
  if (n < 2) {
    return { summary: n === 0 ? 'Aucun plantage ni redémarrage inattendu depuis 30 jours.' : 'Un seul redémarrage inattendu en 30 jours : rien d\'inquiétant.', problems: [], actions: [], advice: [], healthy: true, needsHuman: false };
  }
  const base = `${n} plantages ou redémarrages inattendus en 30 jours${facts.bugchecks > 0 ? `, dont ${facts.bugchecks} écran(s) bleu(s)` : ''}.`;
  if (n >= HARDWARE_SUSPECT) {
    return {
      summary: `${base} C'est trop fréquent pour une simple mise à jour.`,
      problems: ['crashes_frequent'],
      actions: [],
      advice: ['Cause probable : mémoire, disque, surchauffe ou alimentation. Un technicien doit tester le matériel. Sauvegardez vos fichiers en attendant.'],
      healthy: false,
      needsHuman: true,
    };
  }
  const actions: Action[] = tried.has('open_windows_update') ? [] : [openWindowsUpdateAction()];
  return {
    summary: tried.has('open_windows_update') ? `${base} Les mises à jour ont été vérifiées.` : base,
    problems: tried.has('open_windows_update') ? [] : ['crashes_some'],
    actions,
    advice: ['Causes fréquentes : pilote défectueux, surchauffe (ventilateur poussiéreux), disque ou mémoire en fin de vie. Si cela continue, un technicien testera le matériel.'],
    healthy: tried.has('open_windows_update'),
    needsHuman: false,
  };
}

export function crashesSkill(): Skill {
  const tried = new Set<string>();
  return {
    id: 'crashes',
    title: 'Plantages et redémarrages inattendus',
    verifyQuestion: "L'ordinateur redémarre-t-il toujours tout seul ?",
    async diagnose(runner) {
      const d = diagnoseCrashes(parseCrashFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic des plantages')), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
