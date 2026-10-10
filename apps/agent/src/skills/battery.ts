import type { Diagnosis, Skill } from '../types.js';
import { extractJson, guarded, nonNegative, readScript } from './common.js';

/** Batterie : usure. Informatif : l'agent ne peut pas réparer une batterie. */

export interface BatteryFacts {
  present: boolean;
  chargePercent: number | null;
  designMwh: number | null;
  fullMwh: number | null;
}

/** Lecture seule : présence de batterie, capacité d'origine et capacité actuelle à pleine charge. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$b = Get-CimInstance -ClassName Win32_Battery | Select-Object -First 1
$design = (Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryStaticData | Select-Object -First 1).DesignedCapacity
$full = (Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryFullChargedCapacity | Select-Object -First 1).FullChargedCapacity
[pscustomobject]@{ present = [bool]$b; chargePercent = $b.EstimatedChargeRemaining; designMwh = $design; fullMwh = $full } | ConvertTo-Json -Compress
`);

export function parseBatteryFacts(stdout: string): BatteryFacts {
  const raw = extractJson(stdout);
  return {
    present: raw.present === true,
    chargePercent: nonNegative(raw.chargePercent),
    designMwh: nonNegative(raw.designMwh),
    fullMwh: nonNegative(raw.fullMwh),
  };
}

/** Part de capacité perdue (0 à 1), ou null si inconnue. */
export function batteryWear(facts: BatteryFacts): number | null {
  if (!facts.designMwh || facts.fullMwh === null) return null;
  return Math.min(1, Math.max(0, 1 - facts.fullMwh / facts.designMwh));
}

export function diagnoseBattery(facts: BatteryFacts): Diagnosis {
  if (!facts.present) return { summary: 'Pas de batterie sur cet ordinateur.', problems: [], actions: [], advice: [], healthy: true, needsHuman: false };
  const wear = batteryWear(facts);
  const advice: string[] = [];
  let summary = 'Batterie présente ; son usure n\'a pas pu être mesurée.';
  if (wear !== null) {
    const pct = Math.round(wear * 100);
    summary = `Batterie usée à ${pct} % (elle tient ${100 - pct} % de sa durée d'origine).`;
    if (wear >= 0.5) advice.push('La batterie est très usée : prévoyez de la remplacer. En attendant, gardez l\'ordinateur branché sur secteur.');
    else if (wear >= 0.3) advice.push("L'usure de la batterie devient sensible. Évitez de la laisser se décharger complètement.");
  }
  return { summary, problems: [], actions: [], advice, healthy: true, needsHuman: false };
}

export function batterySkill(): Skill {
  return {
    id: 'battery',
    title: 'Batterie : usure',
    verifyQuestion: 'Ces informations vous suffisent-elles ?',
    async diagnose(runner) {
      return diagnoseBattery(parseBatteryFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic de la batterie')));
    },
  };
}
