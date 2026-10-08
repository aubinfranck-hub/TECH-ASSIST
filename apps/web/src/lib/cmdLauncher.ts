/**
 * Fichier .cmd à double-cliquer : il se relance en administrateur puis exécute un script PowerShell écrit juste après le repère
 * « #PS# ». (Un .ps1 s'ouvre dans le Bloc-notes ou est bloqué par Windows.)
 *
 * Précautions qui ont leur importance :
 *  - le repère ne doit apparaître QU'UNE FOIS, au séparateur : le lanceur le cherche par la fin (LastIndexOf) et le script n'en contient pas ;
 *  - pas de bloc « ( … ) » en batch : un chemin du type « Téléchargements (1) » le casserait (on saute vers une étiquette) ;
 *  - le chemin du fichier passe par une variable d'environnement, jamais collé dans une commande entre guillemets.
 */
export const CMD_MARKER = '#PS#';

export function buildSelfElevatingCmd(scriptLines: string[]): string {
  if (scriptLines.some((l) => l.includes(CMD_MARKER))) throw new Error(`Le script ne doit pas contenir ${CMD_MARKER}`);
  const launcher = [
    '@echo off',
    'set "TA_SELF=%~f0"',
    'net session >nul 2>&1',
    'if %errorlevel% neq 0 goto elevate',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $f = Get-Content -LiteralPath $env:TA_SELF -Raw -Encoding UTF8; iex $f.Substring($f.LastIndexOf('${CMD_MARKER}') + ${CMD_MARKER.length}) } catch { Write-Host ('ERREUR : ' + $_.Exception.Message) -ForegroundColor Red }"`,
    'pause',
    'exit /b',
    ':elevate',
    'powershell -NoProfile -Command "Start-Process -FilePath $env:TA_SELF -Verb RunAs"',
    'exit /b',
  ];
  return [...launcher, CMD_MARKER, ...scriptLines].join('\r\n');
}

/** Ce que fait le lanceur pour retrouver le script (même logique), utilisé par les tests. */
export function extractScript(cmdFile: string): string {
  return cmdFile.substring(cmdFile.lastIndexOf(CMD_MARKER) + CMD_MARKER.length);
}

export function downloadCmd(fileName: string, scriptLines: string[]): void {
  const blob = new Blob([buildSelfElevatingCmd(scriptLines)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
