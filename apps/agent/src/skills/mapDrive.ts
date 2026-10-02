import type { Action, Diagnosis, Skill } from '../types.js';
import { extractJson, guarded, psQuote, readScript, runScript, tracked } from './common.js';

/**
 * Lecteur réseau (ex. Z: → \\serveur\partage). L'agent ne demande ni ne saisit JAMAIS de mot de passe :
 * si le serveur en exige un, l'action échoue et un technicien prend la suite.
 */

export const DRIVE_LETTER = /^[D-Z]$/;
/** \\serveur\partage[\sous-dossier…] : lettres, chiffres, espace, _ . $ - ; pas de guillemet ni de caractère spécial. */
export const UNC_PATH = /^\\\\[A-Za-z0-9](?:[A-Za-z0-9.-]{0,62})\\[A-Za-z0-9 _.$-]{1,80}(?:\\[A-Za-z0-9 _.$-]{1,80}){0,5}$/;

export interface MapDriveFacts {
  letter: string;
  unc: string;
  /** Ce que la lettre désigne déjà : '' (libre) ou le chemin réseau actuel. */
  currentRoot: string;
  serverReachable: boolean;
}

export function mapDriveCollectScript(letter: string, unc: string): string {
  assertInputs(letter, unc);
  const server = unc.split('\\')[2]!;
  return guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$letter = ${psQuote(letter)}
$drive = Get-PSDrive -Name $letter -PSProvider FileSystem
$current = ''
if ($drive) { $current = [string]$drive.DisplayRoot; if (-not $current) { $current = [string]$drive.Root } }
$reach = $false
$client = New-Object System.Net.Sockets.TcpClient
try { $reach = $client.ConnectAsync(${psQuote(server)}, 445).Wait(4000) -and $client.Connected } catch { }
$client.Close()
[pscustomobject]@{ currentRoot = $current; serverReachable = [bool]$reach } | ConvertTo-Json -Compress
`);
}

function assertInputs(letter: string, unc: string) {
  if (!DRIVE_LETTER.test(letter)) throw new Error('Lettre de lecteur non valide (D à Z)');
  if (!UNC_PATH.test(unc)) throw new Error('Chemin réseau non valide (forme \\\\serveur\\partage)');
}

export function parseMapDriveFacts(stdout: string, letter: string, unc: string): MapDriveFacts {
  const raw = extractJson(stdout);
  return { letter, unc, currentRoot: String(raw.currentRoot ?? ''), serverReachable: raw.serverReachable === true };
}

const same = (a: string, b: string) => a.replace(/\\+$/, '').toLowerCase() === b.replace(/\\+$/, '').toLowerCase();

function mapAction(letter: string, unc: string): Action {
  assertInputs(letter, unc);
  return {
    id: 'map_drive',
    title: `Connecter le lecteur ${letter}: à ${unc}`,
    explanation: `Je crée le lecteur réseau ${letter}: qui pointe vers ${unc}, avec votre session Windows actuelle (aucun mot de passe n'est demandé ni enregistré par moi). Il réapparaîtra à chaque ouverture de session. Pour le retirer : clic droit sur le lecteur > Déconnecter.`,
    requiresAdmin: false,
    verified: true,
    run: (runner) =>
      runScript(
        runner,
        guarded(`New-PSDrive -Name ${psQuote(letter)} -PSProvider FileSystem -Root ${psQuote(unc)} -Persist -Scope Global | Out-Null\nif (-not (Test-Path -LiteralPath ${psQuote(letter + ':\\')})) { throw "Le serveur n'a pas accepté la connexion (droits ou mot de passe requis)." }\nWrite-Output 'OK'`),
        60_000,
      ),
  };
}

export function diagnoseMapDrive(f: MapDriveFacts, tried: ReadonlySet<string> = new Set()): Diagnosis {
  const base = { actions: [] as Action[], advice: [] as string[], needsHuman: false };
  if (f.currentRoot && same(f.currentRoot, f.unc)) {
    return { ...base, summary: `Le lecteur ${f.letter}: est déjà connecté à ${f.unc}.`, problems: [], healthy: true };
  }
  if (f.currentRoot) {
    return { ...base, summary: `La lettre ${f.letter}: est déjà utilisée (${f.currentRoot}).`, problems: ['letter_in_use'], advice: ['Choisissez une autre lettre libre : je ne remplace pas un lecteur existant.'], healthy: false, needsHuman: true };
  }
  if (!f.serverReachable) {
    return { ...base, summary: `Le serveur de ${f.unc} ne répond pas depuis ce PC.`, problems: ['server_unreachable'], advice: ['Utilisez la vérification « Serveur » pour voir où la liaison s\'arrête.'], healthy: false, needsHuman: true };
  }
  if (tried.has('map_drive')) {
    return { ...base, summary: `Le lecteur ${f.letter}: n'a pas pu être connecté à ${f.unc}.`, problems: ['map_failed'], healthy: false, needsHuman: true };
  }
  return { ...base, summary: `Le lecteur ${f.letter}: est libre et le serveur répond : je peux le connecter.`, problems: ['not_mapped'], actions: [mapAction(f.letter, f.unc)], healthy: false };
}

export function mapDriveSkill(letter: string, unc: string): Skill {
  const script = mapDriveCollectScript(letter, unc);
  const tried = new Set<string>();
  return {
    id: 'map-drive',
    title: `Lecteur réseau ${letter}: vers ${unc}`,
    verifyQuestion: `Voyez-vous le lecteur ${letter}: dans l'Explorateur de fichiers et ouvre-t-il vos dossiers ?`,
    async diagnose(runner) {
      const d = diagnoseMapDrive(parseMapDriveFacts(await readScript(runner, script, 'Le diagnostic du lecteur réseau'), letter, unc), tried);
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
