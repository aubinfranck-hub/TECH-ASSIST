import { describe, expect, it } from 'vitest';
import { elevationCommand, quoteForPowerShell } from '../elevate.js';

describe('relance en administrateur', () => {
  it("relance l'exécutable avec ses options et le drapeau --elevated", () => {
    const cmd = elevationCommand('C:\\Tech Assist\\agent.exe', ['C:\\Tech Assist\\agent.exe', 'C:\\Tech Assist\\agent.exe', '--no-browser']);
    expect(cmd).toBe("Start-Process -FilePath 'C:\\Tech Assist\\agent.exe' -ArgumentList @('--no-browser','--elevated') -Verb RunAs");
  });
  it('sous Node, garde le chemin du script', () => {
    const cmd = elevationCommand('C:\\node\\node.exe', ['C:\\node\\node.exe', 'dist\\cli.js']);
    expect(cmd).toContain("@('dist\\cli.js','--elevated')");
  });
  it('refuse les valeurs qui pourraient sortir des apostrophes', () => {
    expect(quoteForPowerShell("a'b")).toBe("'a''b'");
    expect(quoteForPowerShell('x$(calc)')).toBeNull();
    expect(quoteForPowerShell('x`y')).toBeNull();
    expect(elevationCommand('C:\\a.exe', ['', '', 'ok\u2019; calc'])).toBeNull();
  });
});
