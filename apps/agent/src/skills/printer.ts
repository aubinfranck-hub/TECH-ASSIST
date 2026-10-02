import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, psQuote, readScript, runScript, safeLabel, tracked } from './common.js';
import { serviceSkill } from './services.js';

/**
 * Imprimante : détecter → diagnostiquer → réparer (service d'impression, file bloquée : voir services.ts)
 * → imprimer une page de test. La page de test est la seule vraie preuve : c'est le client qui confirme qu'elle est sortie.
 */

export interface PrinterInfo {
  name: string;
  /** Code numérique Win32_Printer.PrinterStatus (3 inactive, 4 impression, 6 arrêtée, 7 hors connexion…) ; vide si inconnu. */
  status: string;
  workOffline: boolean;
  isDefault: boolean;
}

export interface PrinterFacts {
  printers: PrinterInfo[];
}

/** Lecture seule : imprimantes installées, état, mode « hors connexion », imprimante par défaut. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$printers = @(Get-CimInstance -ClassName Win32_Printer | ForEach-Object {
  [pscustomobject]@{ name = [string]$_.Name; status = [string]$_.PrinterStatus; workOffline = [bool]$_.WorkOffline; isDefault = [bool]$_.Default }
})
[pscustomobject]@{ printers = $printers } | ConvertTo-Json -Depth 3 -Compress
`);

export function parsePrinterFacts(stdout: string): PrinterFacts {
  const raw = extractJson(stdout);
  return {
    printers: asArray<Record<string, unknown>>(raw.printers)
      .map((p) => ({ name: String(p.name ?? ''), status: String(p.status ?? ''), workOffline: p.workOffline === true, isDefault: p.isDefault === true }))
      .filter((p) => p.name),
  };
}

/** Nom d'imprimante accepté dans un script : lettres, chiffres, espace, _ . ( ) # - (pas de guillemet ni de barre oblique). */
export const PRINTER_NAME = /^[\p{L}\p{N} _.()#-]{1,80}$/u;
/** Win32_Printer.PrinterStatus (numérique) : 6 = arrêtée, 7 = hors connexion. */
const OFFLINE_CODES = ['6', '7'];
/** Imprimantes virtuelles : inutile d'y envoyer une page de test. */
const VIRTUAL = /(pdf|xps|onenote|fax)/i;

const testPageAction = (name: string): Action => {
  if (!PRINTER_NAME.test(name)) throw new Error("Nom d'imprimante non accepté");
  return {
    id: 'print_test_page',
    title: `Imprimer une page de test sur « ${name} »`,
    explanation: `J'envoie la page de test de Windows à l'imprimante « ${name} ». Elle consomme une feuille ; c'est la meilleure preuve que l'impression fonctionne. Vérifiez qu'elle sort bien.`,
    requiresAdmin: false,
    verified: false, // printui.dll n'est pas une interface documentée
    followUp: "La page de test est envoyée : attendez quelques secondes qu'elle sorte de l'imprimante.",
    run: (runner) => runScript(runner, guarded(`& rundll32.exe printui.dll,PrintUIEntry /k /n ${psQuote(name)}\nStart-Sleep -Seconds 3\nWrite-Output 'OK'`)),
  };
};

export function diagnosePrinter(facts: PrinterFacts, tested = false): Diagnosis {
  const real = facts.printers.filter((p) => !VIRTUAL.test(p.name));
  if (real.length === 0) {
    return {
      summary: "Aucune imprimante physique n'est installée sur cet ordinateur.",
      problems: ['no_printer'],
      actions: [],
      advice: ["Branchez et allumez l'imprimante (câble USB ou même réseau Wi-Fi), puis ajoutez-la dans Paramètres > Bluetooth et appareils > Imprimantes et scanners."],
      healthy: false,
      needsHuman: false,
    };
  }
  const target = real.find((p) => p.isDefault) ?? real[0]!;
  const advice: string[] = [];
  const bad = real.filter((p) => p.workOffline || OFFLINE_CODES.includes(p.status));
  if (bad.length > 0) {
    const b = bad[0]!;
    advice.push(`« ${safeLabel(b.name)} » est signalée ${b.workOffline ? 'hors connexion' : 'en erreur'} : vérifiez qu'elle est allumée, qu'il y a du papier, qu'il n'y a pas de bourrage, et que le câble ou le Wi-Fi est bien connecté.`);
  }
  if (!PRINTER_NAME.test(target.name) || tested) {
    return { summary: tested ? "La page de test a été envoyée." : `Imprimante « ${safeLabel(target.name)} » détectée.`, problems: [], actions: [], advice, healthy: true, needsHuman: false };
  }
  return {
    summary: `Imprimante « ${safeLabel(target.name)} » détectée${bad.length ? ', mais elle signale un souci' : ''}. Je propose d'imprimer une page de test pour vérifier.`,
    problems: ['verify_print'],
    actions: [testPageAction(target.name)],
    advice,
    healthy: false,
    needsHuman: false,
  };
}

export function printerSkill(): Skill {
  const services = serviceSkill('print');
  const tried = new Set<string>();
  return {
    id: 'printer',
    title: "Imprimante : l'impression ne fonctionne plus",
    verifyQuestion: 'La page de test est-elle bien sortie de l\'imprimante ?',
    async diagnose(runner) {
      const base = await services.diagnose(runner);
      if (!base.healthy) return base;
      const d = diagnosePrinter(parsePrinterFacts(await readScript(runner, COLLECT_SCRIPT, "Le diagnostic de l'imprimante")), tried.has('print_test_page'));
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
