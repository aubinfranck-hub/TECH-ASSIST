import type { Action, CommandRunner, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, psQuote, readScript, runScript } from './common.js';

/**
 * Compétence « désinstaller un logiciel ». Contrairement aux autres, elle ne cherche pas une panne :
 * le client désigne un logiciel de la liste, l'agent lance son désinstallateur officiel (celui de
 * « Applications installées »), après accord, puis relit la liste pour vérifier que c'est parti.
 *
 * L'agent n'exécute jamais une commande lue dans le registre sans la contrôler : voir `planUninstall`.
 */

export interface InstalledProgram {
  /** Nom de la clé de registre (stable) : identifie le programme à la relecture. */
  id: string;
  scope: 'machine' | 'user';
  name: string;
  publisher: string;
  version: string;
  uninstall: string;
  quiet: string;
  /** Installé par Windows Installer (MSI). */
  msi: boolean;
}

/** Lecture seule : programmes installés (machine 64 bits, 32 bits, utilisateur), sans composants système ni mises à jour. */
export const LIST_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$roots = @(
  @{ path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'; scope = 'machine' },
  @{ path = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'; scope = 'machine' },
  @{ path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'; scope = 'user' }
)
$items = New-Object System.Collections.ArrayList
foreach ($r in $roots) {
  Get-ChildItem -Path $r.path | ForEach-Object {
    $p = Get-ItemProperty -LiteralPath $_.PSPath
    if ($p.DisplayName -and ($p.UninstallString -or $p.QuietUninstallString) -and -not $p.SystemComponent -and -not $p.ParentKeyName) {
      [void]$items.Add([pscustomobject]@{
        id = [string]$_.PSChildName; scope = [string]$r.scope; name = [string]$p.DisplayName; publisher = [string]$p.Publisher
        version = [string]$p.DisplayVersion; uninstall = [string]$p.UninstallString; quiet = [string]$p.QuietUninstallString
        msi = ([int]$p.WindowsInstaller -eq 1)
      })
    }
  }
}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ programs = @($items); admin = $admin } | ConvertTo-Json -Depth 4 -Compress
`);

export function parsePrograms(stdout: string): { programs: InstalledProgram[]; admin: boolean | null } {
  const raw = extractJson(stdout);
  const programs = asArray<Record<string, unknown>>(raw.programs)
    .map((p) => ({
      id: String(p.id ?? ''),
      scope: p.scope === 'user' ? ('user' as const) : ('machine' as const),
      name: String(p.name ?? '').trim(),
      publisher: String(p.publisher ?? '').trim(),
      version: String(p.version ?? '').trim(),
      uninstall: String(p.uninstall ?? '').trim(),
      quiet: String(p.quiet ?? '').trim(),
      msi: p.msi === true,
    }))
    .filter((p) => p.id && p.name);
  return { programs, admin: typeof raw.admin === 'boolean' ? raw.admin : null };
}

export async function listInstalledPrograms(runner: CommandRunner): Promise<InstalledProgram[]> {
  return parsePrograms(await readScript(runner, LIST_SCRIPT, 'La liste des logiciels', 60_000)).programs;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Retrouve les logiciels qui correspondent à ce que dit le client (tous les mots, accents et casse ignorés), meilleurs d'abord. */
export function findPrograms(programs: InstalledProgram[], query: string, limit = 8): InstalledProgram[] {
  const tokens = fold(query)
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const q = fold(query).trim();

  const scored = programs
    .map((p) => {
      const name = fold(p.name);
      const hay = `${name} ${fold(p.publisher)}`;
      if (!tokens.every((t) => hay.includes(t))) return null;
      const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3;
      return { p, score };
    })
    .filter((x): x is { p: InstalledProgram; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));

  // Même logiciel listé en 32 et 64 bits, ou en double : une seule ligne.
  const seen = new Set<string>();
  const unique: InstalledProgram[] = [];
  for (const { p } of scored) {
    const key = `${fold(p.name)}|${p.version}|${p.scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique.slice(0, limit);
}

/** Logiciels que l'agent ne désinstalle pas : sécurité, composants partagés, pilotes, Windows, l'agent lui-même. */
const PROTECTED: { pattern: RegExp; why: string }[] = [
  { pattern: /defender|kaspersky|avast|avg\b|eset|norton|mcafee|bitdefender|malwarebytes|sophos|trend micro|avira|f-secure|webroot|crowdstrike|sentinelone/i, why: 'Un antivirus protège votre ordinateur : le retirer sans le remplacer l\'expose.' },
  { pattern: /visual c\+\+|\.net (framework|runtime|desktop|core|sdk)|webview2|directx|vulkan|java( se)? runtime/i, why: 'Ce composant est partagé par d\'autres logiciels : le retirer peut en casser plusieurs.' },
  { pattern: /driver|pilote|chipset|nvidia (graphics|geforce)|intel\(r\)|realtek|amd (software|radeon)/i, why: 'Il s\'agit d\'un pilote de votre matériel : le retirer peut couper l\'écran, le son ou le réseau.' },
  { pattern: /^microsoft (windows|edge)|windows (sdk|update)/i, why: 'C\'est un composant de Windows.' },
  { pattern: /tech ?assist/i, why: 'C\'est l\'application qui vous aide en ce moment.' },
];

export function protectedReason(program: InstalledProgram): string | null {
  for (const { pattern, why } of PROTECTED) if (pattern.test(`${program.name} ${program.publisher}`)) return why;
  return null;
}

/** Dossiers où résident les désinstallateurs légitimes. */
export function defaultRoots(env: Record<string, string | undefined> = process.env): string[] {
  const roots = [
    env.ProgramFiles ?? 'C:\\Program Files',
    env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    env.ProgramW6432,
    env.ProgramData ?? 'C:\\ProgramData',
    env.LOCALAPPDATA,
    env.APPDATA,
  ].filter((r): r is string => !!r && /^[A-Za-z]:\\/.test(r));
  return [...new Set(roots.map((r) => r.replace(/\\+$/, '')))];
}

const DENIED_EXECUTABLES = new Set(['cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe', 'rundll32.exe', 'regsvr32.exe', 'msiexec.exe']);
const GUID_PATTERN = String.raw`\{[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}\}`;
const GUID = new RegExp(`^${GUID_PATTERN}$`);
// Windows écrit « MsiExec.exe /X{…} » ou « MsiExec.exe /I{…} » : la casse varie, d'où le drapeau « i ».
const MSI_COMMAND = new RegExp(String.raw`^"?(?:[A-Za-z]:\\[^"]*\\)?msiexec(?:\.exe)?"?\s+\/[IiXx]\s*(${GUID_PATTERN})`, 'i');

export type UninstallPlan =
  | { ok: true; kind: 'msi' | 'exe'; exe: string; args: string; shown: string }
  | { ok: false; reason: string };

function splitCommand(command: string): { exe: string; args: string } | null {
  const t = command.trim();
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    return end < 0 ? null : { exe: t.slice(1, end), args: t.slice(end + 1).trim() };
  }
  const m = /^(.*?\.exe)(?:\s+([\s\S]*))?$/i.exec(t);
  return m ? { exe: m[1]!, args: (m[2] ?? '').trim() } : null;
}

export function isAllowedExecutable(exe: string, roots: string[]): boolean {
  if (!/^[A-Za-z]:\\/.test(exe) || !/\.exe$/i.test(exe)) return false;
  if (exe.split('\\').some((part) => part === '..' || part === '.')) return false;
  const base = exe.slice(exe.lastIndexOf('\\') + 1).toLowerCase();
  if (DENIED_EXECUTABLES.has(base)) return false;
  const lower = exe.toLowerCase();
  if (lower.includes('\\temp\\')) return false;
  return roots.some((root) => lower.startsWith(`${root.toLowerCase()}\\`));
}

/** Arguments sobres : jamais de métacaractères d'un interpréteur, ni de caractères de contrôle. */
function saneArguments(args: string): boolean {
  return args.length <= 400 && !/[\u0000-\u001f&|;<>^`]/.test(args);
}

/** Décide, sans rien exécuter, de la commande de désinstallation — ou refuse. */
export function planUninstall(program: InstalledProgram, roots: string[] = defaultRoots()): UninstallPlan {
  const reason = protectedReason(program);
  if (reason) return { ok: false, reason };

  // Windows Installer : la commande est construite par nous à partir du seul identifiant du produit.
  const fromCommand = MSI_COMMAND.exec(program.uninstall)?.[1];
  const fromId = program.msi && GUID.test(program.id) ? program.id : undefined;
  const guid = fromCommand ?? fromId;
  if (guid) {
    const args = `/x ${guid} /passive /norestart`;
    return { ok: true, kind: 'msi', exe: 'msiexec.exe', args, shown: `msiexec.exe ${args}` };
  }

  // Sinon : le désinstallateur propre au logiciel, mais seulement s'il vit dans un dossier de programmes.
  for (const candidate of [program.quiet, program.uninstall]) {
    if (!candidate) continue;
    const split = splitCommand(candidate);
    if (!split) continue;
    if (!isAllowedExecutable(split.exe, roots) || !saneArguments(split.args)) continue;
    try {
      psQuote(split.exe);
      psQuote(split.args);
    } catch {
      continue;
    }
    return { ok: true, kind: 'exe', exe: split.exe, args: split.args, shown: `"${split.exe}"${split.args ? ` ${split.args}` : ''}` };
  }
  return { ok: false, reason: "Je ne reconnais pas sa procédure de désinstallation comme sûre : un technicien doit s'en charger." };
}

function uninstallAction(program: InstalledProgram, plan: Extract<UninstallPlan, { ok: true }>): Action {
  const label = `${program.name}${program.version ? ` ${program.version}` : ''}`;
  const check =
    plan.kind === 'msi'
      ? `if (@(0, 1605, 1641, 3010) -notcontains $p.ExitCode) { throw ("Le désinstallateur a répondu avec le code " + $p.ExitCode) }\n`
      : '';
  return {
    id: 'uninstall_program',
    title: `Désinstaller « ${program.name} »`,
    explanation:
      `Je lance la désinstallation officielle de « ${label} »${program.publisher ? ` (${program.publisher})` : ''}. ` +
      `Une fenêtre du programme peut s'ouvrir : suivez-la jusqu'au bout. Vos documents ne sont pas supprimés, mais les réglages du logiciel peuvent l'être. ` +
      `Commande exacte : ${plan.shown}`,
    requiresAdmin: program.scope === 'machine',
    verified: true,
    run: (runner) =>
      runScript(
        runner,
        guarded(
          // msiexec : toujours celui de Windows (jamais résolu via le PATH, qui peut contenir un dossier modifiable).
          `$p = Start-Process -FilePath ${plan.kind === 'msi' ? "(Join-Path $env:windir 'System32\\msiexec.exe')" : psQuote(plan.exe)}${plan.args ? ` -ArgumentList ${psQuote(plan.args)}` : ''} -Wait -PassThru\n${check}Write-Output ('Terminé (code ' + $p.ExitCode + ')')`,
        ),
        15 * 60_000,
      ),
  };
}

/** Compétence ciblée : désinstaller CE logiciel (choisi par le client dans la liste). */
export function uninstallProgramSkill(program: InstalledProgram, roots: string[] = defaultRoots()): Skill {
  return {
    id: 'uninstall',
    title: `Désinstaller « ${program.name} »`,
    verifyQuestion: `« ${program.name} » a-t-il bien disparu de votre ordinateur ?`,
    async diagnose(runner): Promise<Diagnosis> {
      const { programs, admin } = parsePrograms(await readScript(runner, LIST_SCRIPT, 'La liste des logiciels', 60_000));
      const still = programs.find((p) => p.id === program.id && p.scope === program.scope);
      if (!still) {
        return { summary: `« ${program.name} » n'est plus installé.`, problems: [], actions: [], advice: [], healthy: true, needsHuman: false };
      }
      const plan = planUninstall(still, roots);
      if (!plan.ok) {
        return {
          summary: `« ${still.name} » ne peut pas être désinstallé par l'agent. ${plan.reason}`,
          problems: ['uninstall_refused'],
          actions: [],
          advice: [],
          healthy: false,
          needsHuman: true,
        };
      }
      const advice =
        admin === false && still.scope === 'machine' ? ["L'agent n'est pas lancé en administrateur : la désinstallation échouera sans ce droit."] : [];
      return {
        summary: `« ${still.name}${still.version ? ` ${still.version}` : ''} » est installé.`,
        problems: ['program_installed'],
        actions: [uninstallAction(still, plan)],
        advice,
        healthy: false,
        needsHuman: false,
      };
    },
  };
}

