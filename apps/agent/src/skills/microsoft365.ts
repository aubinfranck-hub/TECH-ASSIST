import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, nonNegative, readScript, runScript, safeLabel } from './common.js';

/**
 * Microsoft 365 au quotidien : Teams (cache), OneDrive (synchronisation), licence Office (lecture seule).
 * L'agent ne touche jamais aux documents, aux courriers ni aux comptes : il vide des caches reconstruits
 * automatiquement, relance un programme, ou lit l'état de la licence. Aucun chemin ne vient du serveur ni d'un modèle IA.
 */

const run = (runner: Parameters<typeof runScript>[0], script: string, timeoutMs = 60_000) => runScript(runner, script, timeoutMs);

// ───────────────────────────── Teams ─────────────────────────────

const TEAMS_CACHE_LARGE_MB = 1024;

export interface TeamsFacts {
  /** 'new' : nouveau Teams (MSTeams) ; 'classic' : ancien Teams ; null : absent. */
  kind: 'new' | 'classic' | null;
  running: boolean;
  responding: boolean;
  cacheMb: number;
}

export const TEAMS_COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$newDir = Join-Path $env:LOCALAPPDATA 'Packages\MSTeams_8wekyb3d8bbwe\LocalCache\Microsoft\MSTeams'
$classicDir = Join-Path $env:APPDATA 'Microsoft\Teams'
$kind = $null
$dir = $null
if (Test-Path -LiteralPath $newDir) { $kind = 'new'; $dir = $newDir }
elseif (Test-Path -LiteralPath $classicDir) { $kind = 'classic'; $dir = $classicDir }
$procs = @(Get-Process -Name 'ms-teams','Teams' | ForEach-Object { [pscustomobject]@{ responding = [bool]$_.Responding } })
$mb = 0
if ($dir) { $mb = [int]((Get-ChildItem -LiteralPath $dir -Recurse -Force -File | Measure-Object -Property Length -Sum).Sum / 1MB) }
[pscustomobject]@{ kind = $kind; running = ($procs.Count -gt 0); responding = (@($procs | Where-Object { -not $_.responding }).Count -eq 0); cacheMb = $mb } | ConvertTo-Json -Compress
`);

export function parseTeamsFacts(stdout: string): TeamsFacts {
  const raw = extractJson(stdout);
  return {
    kind: raw.kind === 'new' ? 'new' : raw.kind === 'classic' ? 'classic' : null,
    running: raw.running === true,
    responding: raw.responding !== false,
    cacheMb: nonNegative(raw.cacheMb) ?? 0,
  };
}

function clearTeamsCacheAction(facts: TeamsFacts): Action {
  return {
    id: 'teams_clear_cache',
    title: 'Vider le cache de Microsoft Teams',
    explanation:
      "Je ferme Teams puis je vide son cache (fichiers temporaires). C'est la réparation habituelle des écrans blancs, des connexions qui tournent sans fin et des appels qui se coupent. " +
      'Vos messages, vos fichiers et votre compte ne sont pas touchés : ils sont sur les serveurs Microsoft. Vous devrez peut-être vous reconnecter à Teams.',
    requiresAdmin: false,
    verified: false, // dossiers de cache Microsoft : à valider sur une vraie machine
    followUp: 'Le cache de Teams est vidé. Rouvrez Teams (la première ouverture peut prendre un moment) avant de répondre.',
    run: (runner) =>
      run(
        runner,
        guarded(
          String.raw`Stop-Process -Name 'ms-teams','Teams' -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$dir = ${facts.kind === 'new' ? String.raw`(Join-Path $env:LOCALAPPDATA 'Packages\MSTeams_8wekyb3d8bbwe\LocalCache\Microsoft\MSTeams')` : String.raw`(Join-Path $env:APPDATA 'Microsoft\Teams')`}
if (-not (Test-Path -LiteralPath $dir)) { throw "Le dossier de cache de Teams est introuvable." }
Get-ChildItem -LiteralPath $dir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Write-Output 'OK'`,
        ),
        90_000,
      ),
  };
}

function closeTeamsAction(): Action {
  return {
    id: 'teams_close',
    title: 'Fermer Teams (il ne répond plus)',
    explanation: "Teams ne répond plus. Je le ferme de force ; rien n'est perdu (vos messages sont sur les serveurs Microsoft).",
    requiresAdmin: false,
    verified: true,
    followUp: 'Teams est fermé. Vous pouvez le rouvrir.',
    run: (runner) => run(runner, guarded(`Stop-Process -Name 'ms-teams','Teams' -Force -ErrorAction SilentlyContinue\nWrite-Output 'OK'`)),
  };
}

export function diagnoseTeams(facts: TeamsFacts, options: { cleared?: boolean } = {}): Diagnosis {
  if (!facts.kind) {
    return {
      summary: "Je ne trouve pas Microsoft Teams installé sur cet ordinateur.",
      problems: ['teams_missing'],
      actions: [],
      advice: ["Si vous utilisez Teams dans le navigateur, videz plutôt le cache du navigateur ; un technicien peut vous guider. Pour installer Teams, dites « installe Teams »."],
      healthy: false,
      needsHuman: false,
    };
  }
  const problems: string[] = [];
  const sentences: string[] = [];
  const actions: Action[] = [];
  if (facts.running && !facts.responding) {
    problems.push('teams_not_responding');
    sentences.push('Teams ne répond plus.');
    actions.push(closeTeamsAction());
  }
  if (facts.cacheMb >= TEAMS_CACHE_LARGE_MB) {
    problems.push('teams_cache_large');
    sentences.push(`Le cache de Teams est volumineux (${Math.round(facts.cacheMb / 1024 * 10) / 10} Go).`);
  }
  // Pas de signe visible : le vidage du cache reste la réparation de référence, proposée une seule fois.
  if (!options.cleared) {
    if (problems.length === 0) {
      problems.push('teams_reset_suggested');
      sentences.push("Teams est installé. Je ne vois pas de blocage précis ; vider son cache règle la plupart des problèmes (écran blanc, connexion sans fin, appels coupés).");
    }
    actions.push(clearTeamsCacheAction(facts));
  }
  const healthy = options.cleared === true && problems.every((p) => p === 'teams_cache_large' || p === 'teams_reset_suggested');
  return { summary: healthy ? 'Teams est prêt.' : sentences.join(' '), problems: healthy ? [] : problems, actions, advice: [], healthy, needsHuman: false };
}

export function teamsSkill(): Skill {
  let cleared = false;
  return {
    id: 'teams',
    title: 'Microsoft Teams : ne se connecte pas, écran blanc, appels coupés',
    verifyQuestion: 'Teams fonctionne-t-il normalement maintenant ?',
    async diagnose(runner) {
      const facts = parseTeamsFacts(await readScript(runner, TEAMS_COLLECT_SCRIPT, 'Le diagnostic de Teams', 60_000));
      const d = diagnoseTeams(facts, { cleared });
      for (const action of d.actions) {
        if (action.id !== 'teams_clear_cache') continue;
        const original = action.run;
        action.run = async (r) => {
          const result = await original(r);
          if (result.ok) cleared = true;
          return result;
        };
      }
      return d;
    },
  };
}

// ───────────────────────────── OneDrive ─────────────────────────────

export interface OneDriveFacts {
  /** Programme OneDrive trouvé à l'un des deux emplacements officiels. */
  installed: boolean;
  running: boolean;
  diskFreeGb: number | null;
}

export const ONEDRIVE_COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$a = Join-Path $env:LOCALAPPDATA 'Microsoft\OneDrive\OneDrive.exe'
$b = Join-Path $env:ProgramFiles 'Microsoft OneDrive\OneDrive.exe'
$installed = ((Test-Path -LiteralPath $a) -or (Test-Path -LiteralPath $b))
$running = [bool](Get-Process -Name 'OneDrive')
$drive = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':'))
$free = $null
if ($drive) { $free = [math]::Round($drive.Free / 1GB, 1) }
[pscustomobject]@{ installed = $installed; running = $running; diskFreeGb = $free } | ConvertTo-Json -Compress
`);

export function parseOneDriveFacts(stdout: string): OneDriveFacts {
  const raw = extractJson(stdout);
  return { installed: raw.installed === true, running: raw.running === true, diskFreeGb: nonNegative(raw.diskFreeGb) };
}

const ONEDRIVE_EXE = String.raw`$exe = @((Join-Path $env:LOCALAPPDATA 'Microsoft\OneDrive\OneDrive.exe'), (Join-Path $env:ProgramFiles 'Microsoft OneDrive\OneDrive.exe')) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $exe) { throw "OneDrive est introuvable sur cet ordinateur." }`;

function startOneDriveAction(): Action {
  return {
    id: 'onedrive_start',
    title: 'Démarrer OneDrive',
    explanation: "OneDrive n'est pas lancé, donc vos fichiers ne se synchronisent plus. Je le démarre. Rien n'est supprimé.",
    requiresAdmin: false,
    verified: true,
    followUp: "OneDrive est lancé : son icône (nuage) apparaît près de l'horloge. Laissez-lui quelques instants.",
    run: (runner) => run(runner, guarded(`${ONEDRIVE_EXE}\nStart-Process -FilePath $exe\nWrite-Output 'OK'`)),
  };
}

function resetOneDriveAction(): Action {
  return {
    id: 'onedrive_reset',
    title: 'Réinitialiser la synchronisation OneDrive',
    explanation:
      "Je réinitialise OneDrive : il repart de zéro et re-compare vos dossiers avec le nuage. Aucun fichier n'est supprimé, ni sur votre ordinateur ni en ligne. " +
      "La resynchronisation peut durer de quelques minutes à plusieurs heures selon la quantité de fichiers et votre connexion.",
    requiresAdmin: false,
    verified: false, // l'option /reset est supportée mais non documentée en détail : à valider sur une vraie machine
    followUp: "OneDrive se réinitialise : son icône disparaît puis revient. S'il ne revient pas après deux minutes, dites-le-moi.",
    run: (runner) => run(runner, guarded(`${ONEDRIVE_EXE}\nStart-Process -FilePath $exe -ArgumentList '/reset'\nStart-Sleep -Seconds 45\nWrite-Output 'OK'`), 120_000),
  };
}

export function diagnoseOneDrive(facts: OneDriveFacts, options: { reset?: boolean } = {}): Diagnosis {
  if (!facts.installed) {
    return {
      summary: "Je ne trouve pas OneDrive installé sur cet ordinateur.",
      problems: ['onedrive_missing'],
      actions: [],
      advice: ["OneDrive est fourni avec Windows 10 et 11 : si le programme manque, un technicien peut le réinstaller."],
      healthy: false,
      needsHuman: true,
    };
  }
  const problems: string[] = [];
  const sentences: string[] = [];
  const advice: string[] = [];
  const actions: Action[] = [];
  if (!facts.running) {
    problems.push('onedrive_not_running');
    sentences.push("OneDrive n'est pas lancé : vos fichiers ne se synchronisent pas.");
    actions.push(startOneDriveAction());
  }
  if (facts.diskFreeGb !== null && facts.diskFreeGb < 2) {
    problems.push('disk_low');
    sentences.push(`Il ne reste que ${facts.diskFreeGb} Go sur le disque : OneDrive ne peut plus télécharger vos fichiers.`);
    advice.push("Libérez de la place (compétence « Nettoyage ») : c'est souvent la vraie cause d'une synchronisation bloquée.");
  }
  if (facts.running && problems.length === 0 && !options.reset) {
    problems.push('onedrive_reset_suggested');
    sentences.push("OneDrive tourne et le disque a de la place. Si la synchronisation reste bloquée, une réinitialisation la relance sans rien supprimer.");
  }
  if (!options.reset && facts.running) actions.push(resetOneDriveAction());
  const healthy = problems.length === 0 || (options.reset === true && facts.running && problems.every((p) => p === 'onedrive_reset_suggested'));
  return { summary: healthy ? 'OneDrive est en marche.' : sentences.join(' '), problems: healthy ? [] : problems, actions, advice, healthy, needsHuman: false };
}

export function oneDriveSkill(): Skill {
  let reset = false;
  return {
    id: 'onedrive',
    title: 'OneDrive : la synchronisation est bloquée',
    verifyQuestion: 'Vos fichiers se synchronisent-ils maintenant (icône OneDrive à jour, sans croix rouge) ?',
    async diagnose(runner) {
      const facts = parseOneDriveFacts(await readScript(runner, ONEDRIVE_COLLECT_SCRIPT, 'Le diagnostic de OneDrive', 60_000));
      const d = diagnoseOneDrive(facts, { reset });
      for (const action of d.actions) {
        if (action.id !== 'onedrive_reset') continue;
        const original = action.run;
        action.run = async (r) => {
          const result = await original(r);
          if (result.ok) reset = true;
          return result;
        };
      }
      return d;
    },
  };
}

// ───────────────────────────── Licence Office (lecture seule) ─────────────────────────────

export interface LicenceFacts {
  /** false : outil de licence Office introuvable (Office absent, ou version non prise en charge). */
  toolFound: boolean;
  products: { name: string; status: string }[];
}

export const LICENCE_COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$roots = @($env:ProgramFiles, [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')) | Where-Object { $_ }
$candidates = foreach ($r in $roots) { Join-Path $r 'Microsoft Office\Office16\OSPP.VBS'; Join-Path $r 'Microsoft Office\root\Office16\OSPP.VBS' }
$ospp = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$products = @()
if ($ospp) {
  $cur = $null
  foreach ($l in @(& cscript.exe //Nologo $ospp /dstatus 2>$null)) {
    if ($l -match '^LICENSE NAME:\s*(.+)$') { $cur = [pscustomobject]@{ name = $matches[1].Trim(); status = '' }; $products += $cur }
    elseif ($cur -and $l -match '^LICENSE STATUS:\s*(.+)$') { $cur.status = $matches[1].Trim() }
  }
}
[pscustomobject]@{ toolFound = [bool]$ospp; products = $products } | ConvertTo-Json -Depth 4 -Compress
`);

export function parseLicenceFacts(stdout: string): LicenceFacts {
  const raw = extractJson(stdout);
  return {
    toolFound: raw.toolFound === true,
    products: asArray<Record<string, unknown>>(raw.products)
      .map((p) => ({ name: safeLabel(p.name, 80), status: String(p.status ?? '').replace(/-/g, '').trim().toUpperCase() }))
      .filter((p) => p.name),
  };
}

/** Fonction pure : l'état des licences Office vers un diagnostic. L'agent n'active rien : l'activation passe par le compte du client. */
export function diagnoseLicence(facts: LicenceFacts): Diagnosis {
  if (!facts.toolFound) {
    return {
      summary: "Je ne peux pas lire l'état de la licence Office (Office absent, ou version trop ancienne ou récente pour cet outil).",
      problems: ['licence_unreadable'],
      actions: [],
      advice: ["Ouvrez Word, puis Fichier > Compte : l'état de votre licence y est écrit. Si un message rouge ou « Produit non activé » apparaît, un technicien vous guide."],
      healthy: false,
      needsHuman: true,
    };
  }
  const real = facts.products.filter((p) => p.status);
  if (real.length === 0) {
    return {
      summary: "Je ne trouve aucune licence Office enregistrée sur cet ordinateur.",
      problems: ['licence_none'],
      actions: [],
      advice: ["Connectez-vous à Office avec votre compte professionnel ou scolaire (Fichier > Compte > Se connecter). Si Office n'est pas à vous, un technicien vous conseille."],
      healthy: false,
      needsHuman: true,
    };
  }
  const licensed = real.filter((p) => p.status === 'LICENSED');
  const grace = real.filter((p) => p.status.includes('GRACE'));
  const bad = real.filter((p) => p.status === 'NOTIFICATIONS' || p.status === 'UNLICENSED' || p.status === 'EXTENDEDGRACE');
  if (licensed.length > 0 && bad.length === 0 && grace.length === 0) {
    return { summary: `Votre licence Office est active (${licensed[0]!.name}).`, problems: [], actions: [], advice: [], healthy: true, needsHuman: false };
  }
  const problems = [...grace.map(() => 'licence_grace'), ...bad.map((p) => `licence_${p.status.toLowerCase()}`)];
  const advice = [
    "Ouvrez Word, puis Fichier > Compte > Se connecter avec le compte qui détient la licence (celui de votre entreprise ou votre compte Microsoft).",
    "Si le message persiste, l'abonnement est peut-être expiré : c'est la personne qui paie Office (vous ou l'administrateur de votre entreprise) qui doit le renouveler. Je n'active ni ne contourne jamais une licence.",
  ];
  return {
    summary: `Office n'est pas correctement activé : ${[...bad, ...grace].map((p) => `${p.name} (${p.status === 'NOTIFICATIONS' ? 'notification d’activation' : p.status === 'UNLICENSED' ? 'sans licence' : 'période de grâce'})`).join(' ; ')}.`,
    problems,
    actions: [],
    advice,
    healthy: false,
    needsHuman: true,
  };
}

export function officeLicenceSkill(): Skill {
  return {
    id: 'office-licence',
    title: 'Office : « produit non activé » / licence',
    verifyQuestion: "Le message d'activation a-t-il disparu ?",
    async diagnose(runner) {
      return diagnoseLicence(parseLicenceFacts(await readScript(runner, LICENCE_COLLECT_SCRIPT, 'La lecture de la licence Office', 60_000)));
    },
  };
}
