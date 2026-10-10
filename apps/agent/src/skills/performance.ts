import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, formatBytes, guarded, nonNegative, readScript, runScript, safeLabel, tracked } from './common.js';

/**
 * Lenteur : mémoire, processeur, durée depuis le dernier redémarrage, processus gourmands.
 * Les noms de processus sont affichés, jamais exécutés ; l'agent ne ferme aucun programme du client.
 */

export interface PerformanceFacts {
  totalRamBytes: number;
  freeRamBytes: number;
  cpuPercent: number | null;
  uptimeDays: number;
  top: { name: string; ramBytes: number }[];
  /** Mode d'alimentation actif (identifiant Windows) : en « Économie d'énergie », Windows bride le processeur. */
  powerScheme?: string | null;
}

const POWER_SAVER = 'a1841308-3541-4fab-bc81-f71556f20b4a';
const POWER_BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';

/** Lecture seule : mémoire, charge processeur, durée de fonctionnement, 5 processus les plus gourmands en mémoire. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance -ClassName Win32_OperatingSystem
$cpu = (Get-CimInstance -ClassName Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
$up = (Get-Date) - $os.LastBootUpTime
$top = @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5 | ForEach-Object { [pscustomobject]@{ name = [string]$_.ProcessName; ramBytes = [double]$_.WorkingSet64 } })
$scheme = [regex]::Match((powercfg /getactivescheme | Out-String), '[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}').Value
[pscustomobject]@{ totalRamBytes = [double]$os.TotalVisibleMemorySize * 1024; freeRamBytes = [double]$os.FreePhysicalMemory * 1024; cpuPercent = $cpu; uptimeDays = [double]$up.TotalDays; top = $top; powerScheme = $scheme } | ConvertTo-Json -Depth 3 -Compress
`);

export function parsePerformanceFacts(stdout: string): PerformanceFacts {
  const raw = extractJson(stdout);
  return {
    totalRamBytes: nonNegative(raw.totalRamBytes) ?? 0,
    freeRamBytes: nonNegative(raw.freeRamBytes) ?? 0,
    cpuPercent: nonNegative(raw.cpuPercent),
    uptimeDays: nonNegative(raw.uptimeDays) ?? 0,
    top: asArray<Record<string, unknown>>(raw.top).map((t) => ({ name: safeLabel(t.name, 40), ramBytes: nonNegative(t.ramBytes) ?? 0 })).filter((t) => t.name),
    powerScheme: typeof raw.powerScheme === 'string' && /^[0-9a-f-]{36}$/i.test(raw.powerScheme) ? raw.powerScheme.toLowerCase() : null,
  };
}

/** Ne fait rien elle-même : après l'accord, l'agent propose le redémarrage réel (needsReboot). */
const restartRecommended = (days: number): Action => ({
  id: 'restart_recommended',
  title: "Redémarrer l'ordinateur pour le décharger",
  explanation: `L'ordinateur fonctionne sans redémarrage depuis ${Math.round(days)} jours et sa mémoire est très sollicitée. Un redémarrage règle souvent la lenteur. Je vous le proposerai juste après (délai de 60 secondes, annulable) : enregistrez votre travail avant.`,
  requiresAdmin: false,
  verified: true,
  needsReboot: true,
  run: async () => ({ ok: true, message: 'Redémarrage recommandé' }),
});

/** Remet le mode « Équilibré » : le mode « Économie d'énergie » bride le processeur et ralentit tout. Réversible dans Paramètres > Alimentation. */
const balancedPower = (): Action => ({
  id: 'set_balanced_power',
  title: "Passer l'ordinateur en mode d'alimentation « Équilibré »",
  explanation:
    "L'ordinateur est réglé en « Économie d'énergie » : Windows bride volontairement le processeur, ce qui ralentit tout. Je le passe en mode « Équilibré » (le réglage normal de Windows : rapide quand il le faut, économe sinon). Sur batterie, l'autonomie sera un peu plus courte. Vous pouvez revenir en arrière dans Paramètres > Système > Alimentation.",
  requiresAdmin: false,
  verified: true,
  run: async (runner) => {
    const res = await runScript(runner, guarded(`powercfg /setactive ${POWER_BALANCED}\nif ($LASTEXITCODE -ne 0) { throw "Windows a refusé de changer le mode d'alimentation." }\nWrite-Output 'OK'`));
    return res.ok ? { ok: true, message: 'Mode Équilibré activé', effect: "Mode d'alimentation : Équilibré (au lieu d'Économie d'énergie)" } : res;
  },
});

export function diagnosePerformance(facts: PerformanceFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const problems: string[] = [];
  const sentences: string[] = [];
  const advice: string[] = [];
  const actions: Action[] = [];
  const used = facts.totalRamBytes > 0 ? 1 - facts.freeRamBytes / facts.totalRamBytes : 0;
  const ramHigh = used > 0.9;
  const cpuHigh = facts.cpuPercent !== null && facts.cpuPercent > 90;
  const longUptime = facts.uptimeDays >= 14;
  const heavy = facts.top.slice(0, 3).map((t) => `${t.name} (${formatBytes(t.ramBytes)})`).join(', ');

  if (ramHigh) {
    problems.push('ram_high');
    sentences.push(`La mémoire est utilisée à ${Math.round(used * 100)} % (${formatBytes(facts.totalRamBytes - facts.freeRamBytes)} sur ${formatBytes(facts.totalRamBytes)}).`);
    if (heavy) advice.push(`Programmes les plus gourmands : ${heavy}. Fermez ceux dont vous n'avez pas besoin (je ne ferme rien à votre place).`);
    if (facts.totalRamBytes > 0 && facts.totalRamBytes <= 4 * 1024 ** 3) advice.push('Avec 4 Go de mémoire ou moins, Windows est vite à l\'étroit : ajouter de la mémoire est le vrai remède (un technicien peut le faire).');
  }
  if (cpuHigh) {
    problems.push('cpu_high');
    sentences.push(`Le processeur est utilisé à ${Math.round(facts.cpuPercent!)} %.`);
    if (heavy) advice.push(`Programmes les plus actifs en mémoire : ${heavy}. Un virus ou une mise à jour en cours peut aussi saturer le processeur.`);
  }
  if (longUptime) {
    problems.push('long_uptime');
    sentences.push(`L'ordinateur n'a pas redémarré depuis ${Math.round(facts.uptimeDays)} jours.`);
  }
  if (facts.powerScheme === POWER_SAVER) {
    problems.push('power_saver');
    sentences.push("Le mode d'alimentation est « Économie d'énergie » : Windows bride le processeur.");
    if (!tried.has('set_balanced_power')) actions.push(balancedPower());
  }
  if ((longUptime || (ramHigh && facts.uptimeDays >= 3)) && !tried.has('restart_recommended')) actions.push(restartRecommended(facts.uptimeDays));

  return {
    summary: problems.length === 0 ? `Performances normales (mémoire utilisée à ${Math.round(used * 100)} %).` : sentences.join(' '),
    problems,
    actions,
    advice,
    // Sans action possible, le constat reste un conseil (🟡) : on ne laisse pas la boucle chercher une correction qui n'existe pas.
    healthy: actions.length === 0,
    needsHuman: false,
    metrics: { ramUsedPercent: Math.round(used * 100), ...(facts.cpuPercent !== null ? { cpuPercent: facts.cpuPercent } : {}) },
  };
}

export function performanceSkill(): Skill {
  const tried = new Set<string>();
  return {
    id: 'performance',
    title: 'Performances : ordinateur lent',
    verifyQuestion: "L'ordinateur est-il plus rapide ?",
    async diagnose(runner) {
      const d = diagnosePerformance(parsePerformanceFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic des performances')), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
