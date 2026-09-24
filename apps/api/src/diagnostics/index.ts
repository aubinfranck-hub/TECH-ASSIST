import type { DiagnosticAnswers, DiagnosticResult } from './types.js';
import { runGeminiDiagnostic } from './geminiEngine.js';
import { runLocalDiagnostic } from './localEngine.js';

/**
 * Essaie Gemini si une clé est configurée ; bascule sur le moteur local en cas
 * d'échec ou d'absence de clé. Le client sait toujours quelle source a répondu
 * (source: 'gemini' | 'local_engine') — pas de confiance déguisée.
 */
export async function runDiagnostic(input: DiagnosticAnswers): Promise<DiagnosticResult> {
  if (process.env.GEMINI_API_KEY) {
    try {
      return await runGeminiDiagnostic(input);
    } catch (err) {
      console.warn('Diagnostic Gemini indisponible, bascule sur le moteur local:', err);
    }
  }
  return runLocalDiagnostic(input);
}
