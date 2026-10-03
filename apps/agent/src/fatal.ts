import { spawnSync } from 'node:child_process';

/**
 * Sans fenêtre de terminal (version client), une erreur au démarrage serait invisible : le client double-clique et rien ne se passe.
 * On affiche donc une petite boîte de message Windows, avec un texte simple. Le texte passe par une variable d'environnement
 * (jamais dans la commande), donc rien de ce qu'il contient ne peut être exécuté.
 */
export function fatalMessage(err: unknown): string {
  const detail = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim().slice(0, 240);
  return `Tech Assist n'a pas pu démarrer correctement.\n\nRelancez le programme. Si le problème continue, contactez Tech Assist en indiquant ce message.\n\nDétail : ${detail || 'erreur inconnue'}`;
}

export function notifyFatal(err: unknown): void {
  if (process.platform !== 'win32' || process.stdout.isTTY) return; // en mode terminal, l'erreur est déjà visible
  try {
    spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show($env:TECH_ASSIST_FATAL, 'Tech Assist')"],
      { env: { ...process.env, TECH_ASSIST_FATAL: fatalMessage(err) }, stdio: 'ignore', windowsHide: true, timeout: 120_000 },
    );
  } catch {
    /* rien de plus à faire */
  }
}
