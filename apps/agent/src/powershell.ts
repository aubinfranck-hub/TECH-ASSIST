import { spawn } from 'node:child_process';
import type { CommandResult, CommandRunner } from './types.js';

/**
 * Exécute un script PowerShell sur Windows. Le script est transmis encodé
 * (-EncodedCommand, UTF-16LE en base64) : aucun problème de guillemets, et rien
 * n'est interprété par un shell intermédiaire.
 */
/**
 * Quand PowerShell échoue hors de notre enveloppe (erreur de syntaxe, par exemple),
 * il écrit ses erreurs au format CLIXML sur stderr. On en extrait le texte lisible.
 */
export function cleanStderr(stderr: string): string {
  if (!stderr.includes('#< CLIXML')) return stderr;
  const messages = [...stderr.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) =>
    m[1]!
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\r\n/g, '\n')
      .trim(),
  );
  const text = messages.filter(Boolean).join('\n');
  return text || stderr;
}

export class PowerShellRunner implements CommandRunner {
  runPowerShell(script: string, options: { timeoutMs?: number } = {}): Promise<CommandResult> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const prelude = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n';
    const encoded = Buffer.from(prelude + script, 'utf16le').toString('base64');

    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true,
        // stdin fermé : sinon Windows PowerShell peut attendre indéfiniment une entrée.
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`PowerShell : délai dépassé (${timeoutMs} ms)`));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: cleanStderr(stderr), exitCode: code ?? 1 });
      });
    });
  }
}
