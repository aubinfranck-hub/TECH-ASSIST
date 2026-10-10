import { expect } from 'vitest';

/** Retire le contenu des here-strings @'…'@ : ce qui reste est du PowerShell « nu ». */
function stripHereStrings(script: string) {
  return script.replace(/@'\r?\n[\s\S]*?\r?\n'@/g, '@HERE@');
}

export function checkStructure(script: string) {
  const opens = (script.match(/@'$/gm) ?? []).length;
  const closes = (script.match(/^'@$/gm) ?? []).length;
  expect(closes).toBe(opens); // un here-string PowerShell se ferme obligatoirement en début de ligne
  const bare = stripHereStrings(script);
  expect((bare.match(/\{/g) ?? []).length).toBe((bare.match(/\}/g) ?? []).length);
  expect((bare.match(/\(/g) ?? []).length).toBe((bare.match(/\)/g) ?? []).length);
  expect(script.trimEnd().endsWith('}')).toBe(true); // se termine par le « catch » de l'enveloppe
}

