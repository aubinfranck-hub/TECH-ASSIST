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

import { hasAdminGroup } from '../elevate.js';
import { converse } from '../conversation.js';
import { Recorder, ScriptedConversation, ScriptedRunner } from './fakeScripts.js';

describe('compte administrateur ou standard', () => {
  it('reconnaît l’appartenance au groupe Administrateurs, même sans élévation', () => {
    expect(hasAdminGroup('BUILTIN\\Administrators  Alias  S-1-5-32-544  Groupe utilisé uniquement pour le refus')).toBe(true);
    expect(hasAdminGroup('BUILTIN\\Users  Alias  S-1-5-32-545  Groupe obligatoire')).toBe(false);
  });

  it("un compte standard peut continuer sans, sans jamais exiger le mot de passe", async () => {
    let asked = 0;
    const ui = new ScriptedConversation({ picks: [0] });
    const out = await converse({ runner: new ScriptedRunner([]), ui, reporter: new Recorder(), autonomous: true, isAdmin: false, requestAdmin: async () => { asked += 1; return true; } });
    expect(asked).toBe(0);
    expect(out.relaunched).toBeUndefined();
    expect(ui.choices[0]!.options[0]).toMatch(/Continuer sans/);
  });

  it("s'il a le mot de passe, l'agent se relance avec les droits et cède la place", async () => {
    const ui = new ScriptedConversation({ picks: [1] });
    const out = await converse({ runner: new ScriptedRunner([]), ui, reporter: new Recorder(), autonomous: true, isAdmin: false, requestAdmin: async () => true });
    expect(out).toEqual({ relaunched: true, turns: 0, handedOver: false, outcomes: [] });
  });

  it('si Windows refuse, la conversation continue sans droits', async () => {
    const ui = new ScriptedConversation({ picks: [1] });
    const out = await converse({ runner: new ScriptedRunner([]), ui, reporter: new Recorder(), autonomous: true, isAdmin: false, requestAdmin: async () => false });
    expect(out.relaunched).toBeUndefined();
    expect(ui.said).toContain('continue sans');
  });
});
