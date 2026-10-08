import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrepareScript, buildRevokeScript } from '../remoteAccess.js';

/**
 * L'agent envoie des scripts PowerShell à Windows. Ils étaient testés contre des simulations, jamais lus par un vrai PowerShell : une
 * faute de syntaxe n'apparaissait que chez le client. Ces tests passent chaque script à l'analyseur officiel de PowerShell (sans
 * l'exécuter). Ignorés si pwsh n'est pas installé (variable PWSH pour son chemin).
 */
const PWSH = process.env.PWSH ?? 'pwsh';
const env = { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1' };
const has = spawnSync(PWSH, ['-NoProfile', '-Command', '1'], { env }).status === 0;

/** Messages d'erreur de syntaxe pour une liste de scripts (un nom par script). */
function parse(scripts: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'ta-agent-ps-'));
  const names = Object.keys(scripts);
  names.forEach((name, i) => writeFileSync(join(dir, `${i}.ps1`), scripts[name]!, 'utf8'));
  const cmd = `$names = Get-Content -LiteralPath (Join-Path $env:TA_DIR 'names.txt'); for ($i = 0; $i -lt $names.Count; $i++) { $e = $null; $t = $null; [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $env:TA_DIR "$i.ps1"), [ref]$t, [ref]$e); foreach ($x in $e) { $names[$i] + ' : ' + $x.Message + ' [ligne ' + $x.Extent.StartLineNumber + ']' } }`;
  writeFileSync(join(dir, 'names.txt'), names.join('\n'), 'utf8');
  const r = spawnSync(PWSH, ['-NoProfile', '-Command', cmd], { encoding: 'utf8', env: { ...env, TA_DIR: dir } });
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : sources(p);
    return p.endsWith('.ts') ? [p] : [];
  });
}

describe.skipIf(!has)('Scripts PowerShell de l’agent : analyseur officiel', () => {
  it('partage d’écran et fin d’assistance : syntaxe valide', () => {
    const key = 'A'.repeat(43) + '=';
    expect(
      parse({
        'partage (réseau public)': buildPrepareScript({ custom: false }, 'abcDEF1234'),
        'partage (serveur Tech Assist)': buildPrepareScript({ custom: true, idServer: 'remote.example.com', relayServer: 'remote.example.com', key }, 'abcDEF1234'),
        'fin d’assistance': buildRevokeScript('Zz9Yy8Xx7W'),
      }),
    ).toEqual([]);
  });

  it('tous les scripts String.raw des compétences (réparation, réseau, imprimantes…) : syntaxe valide', () => {
    const scripts: Record<string, string> = {};
    for (const file of sources(join(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/String\.raw`([\s\S]*?)`/g)) {
        const body = m[1]!;
        if (body.includes('${')) continue; // script à paramètres : vérifié ailleurs
        if (/^\s*using System/.test(body)) continue; // code C# compilé par Add-Type, pas du PowerShell
        if (/^\\\{/.test(body)) continue; // expression régulière JavaScript
        const line = text.slice(0, m.index).split('\n').length;
        scripts[`${file.split('/src/')[1]}:${line}`] = body;
      }
    }
    expect(Object.keys(scripts).length).toBeGreaterThan(20); // le repérage fonctionne
    expect(parse(scripts)).toEqual([]);
  });
});
