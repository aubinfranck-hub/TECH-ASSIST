import type { Action, ActionResult, CommandRunner } from '../types.js';

/** Enveloppe commune des scripts : un échec = message sur stderr + code de sortie 1. */
export function guarded(body: string): string {
  return `$ErrorActionPreference = 'Stop'
try {
${body}
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}`;
}

export function asArray<T>(value: unknown): T[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as T[];
}

/** Extrait l'objet JSON de la sortie d'un script, de façon tolérante (BOM, texte parasite autour). */
export function extractJson(stdout: string): Record<string, unknown> {
  const text = stdout.replace(/^﻿/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Réponse de diagnostic illisible');
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
}

/** Exécute un script d'action ; ne lève jamais : renvoie un résultat lisible. */
export async function runScript(runner: CommandRunner, script: string, timeoutMs = 60_000): Promise<ActionResult> {
  try {
    const res = await runner.runPowerShell(script, { timeoutMs });
    if (res.exitCode === 0) return { ok: true, message: res.stdout.trim() || 'OK' };
    return { ok: false, message: res.stderr.trim() || `Échec (code ${res.exitCode})` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Lit un script de lecture seule ; lève une erreur lisible en cas d'échec. */
export async function readScript(runner: CommandRunner, script: string, what: string, timeoutMs = 60_000): Promise<string> {
  const res = await runner.runPowerShell(script, { timeoutMs });
  if (res.exitCode !== 0) throw new Error(res.stderr.trim() || `${what} : échec`);
  return res.stdout;
}

/**
 * Chaîne littérale PowerShell entre apostrophes. Refuse tout ce qui pourrait en sortir :
 * caractères de contrôle et variantes typographiques d'apostrophe (PowerShell les traite
 * comme des apostrophes). Seule valeur autorisée à entrer dans un script sans validation de forme.
 */
export function psQuote(value: string): string {
  if (/[\u0000-\u001f\u007f-\u009f‘’‚‛“”„]/.test(value)) {
    throw new Error('Caractère non autorisé dans une valeur transmise à PowerShell');
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Lit un nombre fini positif ou nul, sinon null. */
export function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Note chaque action proposée dans `tried` quand elle est lancée : le tour suivant peut alors passer à l'hypothèse d'après. */
export function tracked(actions: Action[], tried: Set<string>): Action[] {
  return actions.map((a) => ({
    ...a,
    run: (runner: CommandRunner) => {
      tried.add(a.id);
      return a.run(runner);
    },
  }));
}

/** Texte lu sur la machine (nom de processus, d'appareil…) : affichable, jamais exécutable. Sans caractères de contrôle, borné. */
export function safeLabel(value: unknown, max = 60): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** « 1,2 Go », « 340 Mo » : tailles lisibles en français. */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1).replace('.', ',')} Go`;
  const mb = bytes / 1024 ** 2;
  if (mb >= 1) return `${Math.round(mb)} Mo`;
  return `${Math.round(bytes / 1024)} Ko`;
}


/**
 * Hôte acceptable pour un serveur d'entreprise : un nom (court ou complet) ou une adresse IPv4 PRIVÉE.
 * Refuse les adresses publiques (un partage monté vers Internet enverrait l'authentification Windows de la session)
 * et les noms contenant « .. ».
 */
export function isLocalHost(host: string): boolean {
  if (host.includes('..')) return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return !/^[\d.]+$/.test(host); // « 1.2.3 » ou autre suite de chiffres/points : pas un nom
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127 || (a === 169 && b === 254);
}
