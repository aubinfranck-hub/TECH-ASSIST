import type { ActionResult, CommandRunner } from '../types.js';

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
