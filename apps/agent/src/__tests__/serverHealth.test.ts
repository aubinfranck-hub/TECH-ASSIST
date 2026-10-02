import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { diagnoseServerHealth, parseServerHealth, serverHealthScript, serverHealthSkill, type ServerHealthFacts } from '../skills/serverHealth.js';
import { resolveSkill } from '../skills/index.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';
import { checkStructure } from './structure.js';

const good = (): ServerHealthFacts => ({
  host: 'srv-compta', readable: true, uptimeDays: 12,
  disks: [{ name: 'C:', freePercent: 45, freeGb: 90 }], memoryUsedPercent: 55, stoppedAutoServices: [], errorsLast24h: 2,
});

describe('santé d’un serveur (lecture seule)', () => {
  it('serveur sain', () => {
    expect(diagnoseServerHealth(good())).toMatchObject({ healthy: true, needsHuman: false, actions: [] });
  });
  it('tout problème passe à un humain, sans aucune action proposée', () => {
    const d = diagnoseServerHealth({ ...good(), disks: [{ name: 'D:', freePercent: 4, freeGb: 8 }], memoryUsedPercent: 95, stoppedAutoServices: ['Sauvegarde'], errorsLast24h: 40 });
    expect(d.problems).toEqual(['disk_low:D:', 'memory_high', 'services_stopped', 'many_errors']);
    expect(d).toMatchObject({ needsHuman: true, actions: [] });
    expect(d.summary).toContain('🔴 Disque D: : 4 % libre');
  });
  it('lecture refusée : le dit franchement', () => {
    const f = parseServerHealth(JSON.stringify({ host: 'srv', readable: false }), 'srv');
    expect(diagnoseServerHealth(f)).toMatchObject({ problems: ['server_unreadable'], needsHuman: true });
  });
  it('longue durée sans redémarrage : conseil', () => {
    expect(diagnoseServerHealth({ ...good(), uptimeDays: 200 }).advice.join(' ')).toMatch(/200 jours/);
  });
  it('les valeurs lues sont assainies', () => {
    const f = parseServerHealth(JSON.stringify({ readable: true, disks: [{ name: "C:'; calc", freePercent: 5, freeGb: 1 }, { name: 'C:', freePercent: 50, freeGb: 10 }], stoppedAutoServices: ["Mon 'service'\n"] }), 'h');
    expect(f.disks).toEqual([{ name: 'C:', freePercent: 50, freeGb: 10 }]);
    expect(f.stoppedAutoServices).toEqual(["Mon 'service'"]);
  });
  it('hôte refusé : adresse publique, caractères spéciaux ; script en lecture seule et bien formé', () => {
    for (const h of ['8.8.8.8', "srv'; calc", 'a..b']) expect(() => serverHealthScript(h)).toThrow();
    expect(resolveSkill('server-health:8.8.8.8')).toBeUndefined();
    const script = serverHealthScript('srv-compta');
    checkStructure(script);
    expect(script).not.toMatch(/Set-|Start-|Stop-|Remove-(?!CimSession)|Restart-|Invoke-Command|Enable-|Disable-|Clear-|-Credential|Get-Credential/);
  });
  it('de bout en bout : lecture, constat, passage de main si problème', async () => {
    const runner = new ScriptedRunner([
      { label: 'read', test: (s) => s.includes('New-CimSession'), reply: () => ok(JSON.stringify({ readable: true, disks: [{ name: 'C:', freePercent: 3, freeGb: 4 }], memTotalKb: 100, memFreeKb: 50 })) },
    ]);
    const out = await runSkill(serverHealthSkill('srv-compta'), { runner, ui: new ScriptedConversation(), reporter: new Recorder() });
    expect(out.status).toBe('escalated');
  });
});
