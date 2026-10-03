import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error script .mjs sans déclaration de types
import { patchFile, readSubsystem, setSubsystem, subsystemOffset } from '../../scripts/pe-subsystem.mjs';

/** Faux exécutable PE minimal : en-tête MZ, signature PE, en-tête optionnel PE32+ et une « charge » après. */
function fakePe(subsystem: number, plus = true): Buffer {
  const pe = 0x80;
  const buf = Buffer.alloc(0x400, 0xaa);
  buf.fill(0, 0, 0x200);
  buf[0] = 0x4d;
  buf[1] = 0x5a;
  buf.writeUInt32LE(pe, 0x3c);
  buf.write('PE\0\0', pe, 'latin1');
  buf.writeUInt16LE(plus ? 0x20b : 0x10b, pe + 24);
  buf.writeUInt16LE(subsystem, pe + 24 + 68);
  return buf;
}

describe('sous-système de l\'exécutable (console ou fenêtre)', () => {
  it('lit et modifie seulement les 2 octets du sous-système', () => {
    const buf = fakePe(3);
    const before = Buffer.from(buf);
    expect(readSubsystem(buf)).toBe(3);
    const offset = setSubsystem(buf, 2);
    expect(readSubsystem(buf)).toBe(2);
    expect(offset).toBe(0x80 + 24 + 68);
    const changed = [...buf.keys()].filter((i) => buf[i] !== before[i]);
    expect(changed).toEqual([offset]); // 3 -> 2 : un seul octet diffère
  });

  it('fonctionne aussi pour un exécutable 32 bits', () => {
    const buf = fakePe(3, false);
    expect(subsystemOffset(buf)).toBe(0x80 + 24 + 68);
  });

  it("refuse un fichier qui n'est pas un exécutable", () => {
    expect(() => subsystemOffset(Buffer.from('pas un exe'.padEnd(100, ' ')))).toThrow(/MZ/);
    const bad = fakePe(3);
    bad.write('XX\0\0', 0x80, 'latin1');
    expect(() => subsystemOffset(bad)).toThrow(/PE/);
  });

  it('modifie un fichier sur place et laisse le reste intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pe-'));
    try {
      const file = join(dir, 'agent.exe');
      const original = fakePe(3);
      writeFileSync(file, original);
      expect(patchFile(file, 'gui')).toBe(2);
      const after = readFileSync(file);
      expect(after.length).toBe(original.length);
      expect(readSubsystem(after)).toBe(2);
      expect(after.subarray(0x200).equals(original.subarray(0x200))).toBe(true);
      patchFile(file, 'console');
      expect(readSubsystem(readFileSync(file))).toBe(3);
      expect(() => patchFile(file, 'autre' as never)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
