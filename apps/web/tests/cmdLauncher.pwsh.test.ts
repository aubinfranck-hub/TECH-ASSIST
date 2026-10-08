import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSelfElevatingCmd, extractScript } from '../src/lib/cmdLauncher.js';
import { clientScriptLines, serverConfigString, toolInstallerLines } from '../src/lib/rustdeskScripts.js';

/**
 * Ces tests utilisent le VRAI PowerShell (pwsh), comme Windows : c'est lui qui avait refusé le fichier (« Jeton inattendu ERREUR »).
 * Ils sont ignorés si pwsh n'est pas installé (variable PWSH pour indiquer son chemin).
 */
const PWSH = process.env.PWSH ?? 'pwsh';
const has = spawnSync(PWSH, ['-NoProfile', '-Command', '1'], { env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' } }).status === 0;

const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(PWSH, ['-NoProfile', ...args], { encoding: 'utf8', env: { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', ...env } });

/** Erreurs de syntaxe PowerShell d'un script (analyseur officiel, sans l'exécuter). */
function syntaxErrors(script: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'ta-ps-'));
  const file = join(dir, 'script.ps1');
  writeFileSync(file, script, 'utf8');
  const r = run(['-Command', `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile($env:TA_FILE,[ref]$t,[ref]$e); $e | ForEach-Object { $_.Message + ' [ligne ' + $_.Extent.StartLineNumber + ']' }`], { TA_FILE: file });
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

const KEY = 'A'.repeat(43) + '=';
const server = { idServer: 'remote.example.com', relayServer: 'remote.example.com', key: KEY };
const windows = { url: 'https://github.com/rustdesk/rustdesk/releases/download/1.4.9/rustdesk-1.4.9-x86_64.exe', sha256: 'e'.repeat(64) };

describe.skipIf(!has)('Scripts téléchargés : vérifiés par le vrai PowerShell', () => {
  it('script du technicien (serveur Tech Assist) : syntaxe valide', () => {
    expect(syntaxErrors(toolInstallerLines({ configString: serverConfigString(server), windows }).join('\r\n'))).toEqual([]);
  });

  it('script du technicien (réseau public) : syntaxe valide', () => {
    expect(syntaxErrors(toolInstallerLines({ windows }).join('\r\n'))).toEqual([]);
  });

  it('script du client (avec et sans serveur auto-hébergé) : syntaxe valide', () => {
    const base = { apiBase: 'https://api.example.com', sessionId: '11111111-2222-3333-4444-555555555555', bootstrapToken: 'tok_abcdefghijklmnopqrstuvwxyz', windows };
    expect(syntaxErrors(clientScriptLines({ ...base, rustdesk: server }).join('\r\n'))).toEqual([]);
    expect(syntaxErrors(clientScriptLines({ ...base, rustdesk: null }).join('\r\n'))).toEqual([]);
  });

  it('le défaut d’origine est reproduit : le premier repère donne EXACTEMENT l’erreur vue par le technicien ; le dernier repère est valide', () => {
    const cmd = buildSelfElevatingCmd(toolInstallerLines({ configString: serverConfigString(server), windows }));
    const naive = cmd.substring(cmd.indexOf('#PS#') + 4);
    const errors = syntaxErrors(naive);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/ERREUR/);
    expect(syntaxErrors(extractScript(cmd))).toEqual([]);
  });

  it('le lanceur, exécuté tel quel par PowerShell, retrouve et exécute le script (et rien d’autre)', () => {
    const cmd = buildSelfElevatingCmd(['Write-Output "SCRIPT-EXECUTE"', 'Write-Output ("a" + "b")']);
    const dir = mkdtempSync(join(tmpdir(), 'ta-cmd-'));
    const file = join(dir, 'Téléchargements (1)', 'test.cmd'); // un dossier « (1) » ne doit rien casser
    const folder = join(dir, 'Téléchargements (1)');
    spawnSync('mkdir', ['-p', folder]);
    writeFileSync(file, cmd, 'utf8');
    // La ligne PowerShell du lanceur, telle que Windows la passerait (entre les guillemets de -Command).
    const line = cmd.split('\r\n').find((l) => l.startsWith('powershell -NoProfile -ExecutionPolicy Bypass -Command "'))!;
    const command = line.slice(line.indexOf('-Command "') + '-Command "'.length, -1);
    const r = run(['-Command', command], { TA_SELF: file });
    expect(r.stdout).toContain('SCRIPT-EXECUTE');
    expect(r.stdout).toContain('ab');
    expect(r.stdout).not.toContain('ERREUR');
    expect(r.stderr).toBe('');
  });

  it('une erreur dans le script est affichée proprement (message lisible, pas un jargon de syntaxe)', () => {
    const cmd = buildSelfElevatingCmd(['throw "Installation impossible."']);
    const dir = mkdtempSync(join(tmpdir(), 'ta-cmd-'));
    const file = join(dir, 'test.cmd');
    writeFileSync(file, cmd, 'utf8');
    const line = cmd.split('\r\n').find((l) => l.startsWith('powershell -NoProfile -ExecutionPolicy Bypass -Command "'))!;
    const r = run(['-Command', line.slice(line.indexOf('-Command "') + '-Command "'.length, -1)], { TA_SELF: file });
    expect(r.stdout + r.stderr).toContain('ERREUR : Installation impossible.');
  });
});
