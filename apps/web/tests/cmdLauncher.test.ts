import { describe, expect, it } from 'vitest';
import { CMD_MARKER, buildSelfElevatingCmd, extractScript } from '../src/lib/cmdLauncher.js';

const SCRIPT = ['$ErrorActionPreference = "Stop"', 'Write-Host "Termine. Revenez sur la console."', '$x = "#PS"'];

describe('Lanceur .cmd (client et technicien)', () => {
  it('retrouve EXACTEMENT le script, sans une miette du lanceur (le défaut : le repère était aussi dans le lanceur)', () => {
    const cmd = buildSelfElevatingCmd(SCRIPT);
    expect(extractScript(cmd)).toBe('\r\n' + SCRIPT.join('\r\n'));
    // Le repère n'apparaît qu'une seule fois dans tout le fichier, au séparateur, hors du texte de la commande PowerShell.
    const occurrences = cmd.split(CMD_MARKER).length - 1;
    expect(occurrences).toBe(2); // une fois dans la recherche du lanceur, une fois au séparateur
    expect(cmd.lastIndexOf(CMD_MARKER)).toBeGreaterThan(cmd.indexOf(':elevate'));
  });

  it('un « premier repère » naïf aurait pris du lanceur dans le script : la recherche par la fin évite cela', () => {
    const cmd = buildSelfElevatingCmd(SCRIPT);
    const naive = cmd.substring(cmd.indexOf(CMD_MARKER) + CMD_MARKER.length);
    expect(naive).toContain('pause'); // ce que l'ancienne version exécutait par erreur
    expect(extractScript(cmd)).not.toContain('pause');
    expect(extractScript(cmd)).not.toContain('exit /b');
  });

  it('pas de bloc « ( … ) » en batch (un chemin « Téléchargements (1) » le casserait) ; le chemin passe par une variable', () => {
    const full = buildSelfElevatingCmd(SCRIPT);
    const launcher = full.slice(0, full.lastIndexOf(CMD_MARKER));
    expect(launcher).not.toMatch(/^\s*if .*\($/m);
    expect(launcher).toContain('set "TA_SELF=%~f0"');
    expect(launcher).toContain('goto elevate');
    expect(launcher).toContain(':elevate');
    expect(launcher.indexOf('exit /b')).toBeLessThan(launcher.indexOf(':elevate'));
  });

  it('refuse un script qui contiendrait le repère', () => {
    expect(() => buildSelfElevatingCmd(['echo #PS# truc'])).toThrow();
  });
});
