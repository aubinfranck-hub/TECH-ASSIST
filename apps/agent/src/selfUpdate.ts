import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

/**
 * Mise à jour automatique de l'exécutable. Au démarrage, l'agent compare sa version à celle publiée
 * (fichier latest.json de la release « agent-latest »), télécharge la nouvelle, vérifie son empreinte SHA-256,
 * remplace son propre fichier (Windows autorise de renommer un .exe en cours d'exécution) et se relance.
 * Jamais bloquant : sans Internet, sans droit d'écriture ou en cas de doute, l'agent continue avec sa version.
 */

declare const __AGENT_VERSION__: string | undefined;

/** Numéro de version injecté à la fabrication du .exe ; « dev » en développement (pas de mise à jour). */
export const AGENT_VERSION: string = typeof __AGENT_VERSION__ === 'string' ? __AGENT_VERSION__ : 'dev';

export const DEFAULT_UPDATE_BASE = 'https://github.com/aubinfranck-hub/TECH-ASSIST/releases/download/agent-latest';

export interface UpdateManifest {
  version: string;
  files: Record<string, { sha256: string }>;
}

export type UpdateResult =
  | { status: 'skipped'; reason: string }
  | { status: 'current'; version: string }
  | { status: 'failed'; reason: string }
  | { status: 'restarting'; version: string };

/** 1 si a > b, -1 si a < b, 0 si égales (versions « 0.1.57 »). Une version illisible n'est jamais plus récente. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number(x));
  const pb = b.split('.').map((x) => Number(x));
  if ([...pa, ...pb].some((n) => !Number.isInteger(n) || n < 0)) return 0;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function parseManifest(raw: unknown): UpdateManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as { version?: unknown; files?: unknown };
  if (typeof m.version !== 'string' || !/^\d+(\.\d+){1,3}$/.test(m.version)) return null;
  if (!m.files || typeof m.files !== 'object') return null;
  const files: UpdateManifest['files'] = {};
  for (const [name, v] of Object.entries(m.files as Record<string, unknown>)) {
    const sha = (v as { sha256?: unknown } | null)?.sha256;
    if (/^[A-Za-z0-9._-]+\.exe$/.test(name) && typeof sha === 'string' && /^[0-9a-f]{64}$/i.test(sha)) files[name] = { sha256: sha.toLowerCase() };
  }
  return Object.keys(files).length ? { version: m.version, files } : null;
}

export interface UpdateDeps {
  currentVersion?: string;
  exePath?: string;
  args?: string[];
  base?: string;
  fetchImpl?: typeof fetch;
  /** Relance la nouvelle version (remplaçable dans les tests). */
  relaunch?: (exePath: string, args: string[]) => void;
}

function defaultRelaunch(exePath: string, args: string[]): void {
  spawn(exePath, args, { detached: true, stdio: 'ignore' }).unref();
}

/** Supprime le fichier laissé par la mise à jour précédente. */
export async function cleanupOldVersion(exePath: string = process.execPath): Promise<void> {
  await unlink(`${exePath}.old`).catch(() => undefined);
  await unlink(`${exePath}.new`).catch(() => undefined);
}

/**
 * Nom du fichier publié qui correspond à cet exécutable. Le navigateur renomme les téléchargements répétés
 * (« tech-assist-agent (1).exe ») et le client peut renommer le fichier : seul le type compte (technicien « console » ou client).
 */
export function publishedName(fileName: string): string {
  if (/technicien/i.test(fileName)) return 'tech-assist-technicien.exe';
  return /console/i.test(fileName) ? 'tech-assist-agent-console.exe' : 'tech-assist-agent.exe';
}

export async function checkForUpdate(deps: UpdateDeps = {}): Promise<UpdateResult> {
  const currentVersion = deps.currentVersion ?? AGENT_VERSION;
  const exePath = deps.exePath ?? process.execPath;
  const args = deps.args ?? process.argv.slice(1);
  const base = (deps.base ?? process.env.TECH_ASSIST_UPDATE_URL ?? DEFAULT_UPDATE_BASE).replace(/\/$/, '');
  const doFetch = deps.fetchImpl ?? fetch;

  if (process.env.TECH_ASSIST_NO_UPDATE === '1' || args.includes('--no-update')) return { status: 'skipped', reason: 'désactivée' };
  if (args.includes('--updated')) return { status: 'skipped', reason: 'vient d\'être mise à jour' };
  if (!/^\d+(\.\d+)+$/.test(currentVersion)) return { status: 'skipped', reason: 'version de développement' };
  if (!/^https:\/\//i.test(base)) return { status: 'skipped', reason: 'adresse de mise à jour non sécurisée' };

  // Connexion lente (réseau mobile) : trois essais, 20 s chacun, avant de conclure qu'on est hors connexion.
  let manifest: UpdateManifest | null = null;
  let manifestFailure = 'hors connexion';
  for (let attempt = 0; attempt < 3 && !manifest; attempt++) {
    try {
      const res = await doFetch(`${base}/latest.json`, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
      if (!res.ok) {
        manifestFailure = `manifeste indisponible (${res.status})`;
        if (res.status >= 400 && res.status < 500) break;
        continue;
      }
      const parsed = parseManifest(await res.json());
      if (!parsed) return { status: 'failed', reason: 'manifeste illisible' };
      manifest = parsed;
    } catch {
      manifestFailure = 'hors connexion';
    }
  }
  if (!manifest) return { status: 'skipped', reason: manifestFailure };
  if (compareVersions(manifest.version, currentVersion) <= 0) return { status: 'current', version: currentVersion };

  const name = publishedName(basename(exePath));
  const entry = manifest.files[name];
  if (!entry) return { status: 'skipped', reason: `pas de fichier ${name} dans la version ${manifest.version}` };

  const tmp = `${exePath}.new`;
  const old = `${exePath}.old`;
  try {
    const res = await doFetch(`${base}/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(900_000), redirect: 'follow' });
    if (!res.ok) return { status: 'failed', reason: `téléchargement refusé (${res.status})` };
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 1_000_000 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return { status: 'failed', reason: 'fichier téléchargé invalide' };
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) return { status: 'failed', reason: 'empreinte SHA-256 différente : mise à jour refusée' };
    await writeFile(tmp, bytes);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    return { status: 'failed', reason: err instanceof Error ? err.message : 'téléchargement impossible' };
  }

  try {
    await unlink(old).catch(() => undefined);
    await rename(exePath, old);
  } catch {
    await unlink(tmp).catch(() => undefined);
    return { status: 'failed', reason: 'dossier non modifiable (droits insuffisants)' };
  }
  try {
    await rename(tmp, exePath);
  } catch {
    await rename(old, exePath).catch(() => undefined); // retour arrière : l'agent reste utilisable
    await unlink(tmp).catch(() => undefined);
    return { status: 'failed', reason: 'remplacement impossible' };
  }
  (deps.relaunch ?? defaultRelaunch)(exePath, [...args, '--updated']);
  return { status: 'restarting', version: manifest.version };
}

