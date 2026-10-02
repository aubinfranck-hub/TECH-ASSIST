import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { guarded, readScript } from './skills/common.js';
import type { CommandRunner, ConversationUi } from './types.js';

/** Adresse du serveur Tech Assist : fixée à la fabrication du programme, modifiable pour les essais. */
export const DEFAULT_API_BASE = 'https://tech-assist-api.onrender.com';

export interface SavedAccount {
  installId: string;
  token?: string;
  email?: string;
}

export interface AccountStore {
  load(): SavedAccount;
  save(account: SavedAccount): void;
}

/** Fichier local de l'utilisateur (%APPDATA%\TechAssist\compte.json). Aucun mot de passe : seulement un jeton. */
export class FileAccountStore implements AccountStore {
  constructor(private readonly path: string = join(process.env.APPDATA ?? process.cwd(), 'TechAssist', 'compte.json')) {}

  load(): SavedAccount {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<SavedAccount>;
      if (typeof parsed.installId === 'string' && parsed.installId.length >= 16) {
        return {
          installId: parsed.installId,
          token: typeof parsed.token === 'string' ? parsed.token : undefined,
          email: typeof parsed.email === 'string' ? parsed.email : undefined,
        };
      }
    } catch {
      // premier lancement ou fichier illisible : on repart d'une installation neuve
    }
    return { installId: randomUUID() };
  }

  save(account: SavedAccount): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(account), { mode: 0o600 });
  }
}

const MACHINE_ID_SCRIPT = guarded(String.raw`
$id = (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Cryptography' -Name MachineGuid).MachineGuid
@{ id = [string]$id } | ConvertTo-Json -Compress
`);

/** Empreinte de l'appareil (SHA-256 de l'identifiant machine) : empêche de réutiliser l'offre gratuite avec un autre email. */
export async function readHardwareHash(runner: CommandRunner): Promise<string | undefined> {
  try {
    const out = await readScript(runner, MACHINE_ID_SCRIPT, "l'identifiant de l'appareil", 15_000);
    const id = (JSON.parse(out.slice(out.indexOf('{'))) as { id?: unknown }).id;
    if (typeof id !== 'string' || !/^[0-9a-fA-F-]{16,64}$/.test(id)) return undefined;
    return createHash('sha256').update(`tech-assist:${id.toLowerCase()}`).digest('hex');
  } catch {
    return undefined;
  }
}

export interface Entitlements {
  freeOfferAvailable: boolean;
  subscription: { endsAt: string } | null;
  aiAgentAvailable: boolean;
}

export interface StartedSession {
  token: string;
  sessionId: string;
  coverage: 'subscription' | 'free_offer';
  fallbackToHuman: boolean;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class AppApi {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, body: unknown, token?: string, method = 'POST'): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base.replace(/\/$/, '')}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new ApiError('Impossible de joindre Tech Assist. Vérifiez votre connexion Internet.', 0);
    }
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      const message = typeof data?.error === 'string' ? data.error : `Erreur du serveur (${res.status}).`;
      throw new ApiError(message, res.status, typeof data?.code === 'string' ? data.code : undefined);
    }
    return data as T;
  }

  requestCode(email: string) {
    return this.call<{ sent: boolean }>('/app/email-code', { email });
  }
  register(input: { installId: string; email: string; code: string; phone: string; name?: string; hardwareHash?: string }) {
    return this.call<{ token: string; entitlements: Entitlements }>('/app/register', { platform: 'windows', ...input });
  }
  me(token: string) {
    return this.call<{ email: string; entitlements: Entitlements }>('/app/me', null, token, 'GET');
  }
  startAssistance(token: string) {
    return this.call<{
      session: { id: string };
      coverage: 'subscription' | 'free_offer';
      fallbackToHuman: boolean;
    }>('/app/assistance', { mode: 'ia' }, token);
  }
  subscribe(token: string) {
    return this.call<{ order: { id: string; amount_fcfa: number } }>('/app/subscribe', {}, token);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9]{8,15}$/;
const CODE = /^[0-9]{6}$/;

async function askValid(ui: ConversationUi, prompt: string, ok: (v: string) => boolean, retry: string): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    const answer = await ui.ask(i === 0 ? prompt : retry);
    if (answer === null) return null;
    const cleaned = answer.trim();
    if (ok(cleaned)) return cleaned;
  }
  return null;
}

export interface AccountDeps {
  ui: ConversationUi;
  api: AppApi;
  store: AccountStore;
  hardwareHash?: string;
}

/** Connexion (email + code) : réutilise le jeton enregistré s'il est encore valable. Rend le jeton, ou null si abandon. */
export async function signIn(deps: AccountDeps): Promise<{ token: string; entitlements: Entitlements } | null> {
  const { ui, api, store } = deps;
  const saved = store.load();

  if (saved.token) {
    try {
      const me = await api.me(saved.token);
      return { token: saved.token, entitlements: me.entitlements };
    } catch (err) {
      if (!(err instanceof ApiError) || err.status === 0) {
        ui.info(err instanceof Error ? err.message : 'Connexion impossible.');
        return null;
      }
      // jeton refusé : on se reconnecte avec un nouveau code
    }
  }

  ui.info("Pour commencer, je dois vérifier votre adresse email (c'est ce qui vous donne droit à votre assistance offerte).");
  const email = (
    await askValid(ui, 'Quelle est votre adresse email ?', (v) => EMAIL.test(v), "Cette adresse n'a pas l'air valide. Exemple : nom@exemple.com")
  )?.toLowerCase();
  if (!email) return null;

  try {
    await api.requestCode(email);
  } catch (err) {
    ui.info(err instanceof Error ? err.message : "Impossible d'envoyer le code.");
    return null;
  }
  ui.info(`Un code à 6 chiffres vient d'être envoyé à ${email}. Pensez à regarder les courriers indésirables.`);

  const phoneAnswer = await askValid(
    ui,
    'Votre numéro de téléphone (pour que nous puissions vous joindre) :',
    (v) => PHONE.test(v.replace(/[\s.-]/g, '')),
    'Numéro invalide : 8 à 15 chiffres, avec ou sans +.',
  );
  if (!phoneAnswer) return null;
  const phone = phoneAnswer.replace(/[\s.-]/g, '');

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await askValid(ui, 'Entrez le code reçu par email :', (v) => CODE.test(v), 'Le code comporte 6 chiffres.');
    if (!code) return null;
    try {
      const result = await api.register({ installId: saved.installId, email, code, phone, hardwareHash: deps.hardwareHash });
      store.save({ installId: saved.installId, token: result.token, email });
      return { token: result.token, entitlements: result.entitlements };
    } catch (err) {
      ui.info(err instanceof Error ? err.message : 'Inscription impossible.');
      // Seul un code faux (400) mérite un nouvel essai ; le reste (déjà inscrit, réseau…) est définitif.
      if (!(err instanceof ApiError) || err.status !== 400) return null;
    }
  }
  return null;
}

/** Démarre l'assistance couverte (offerte, ou abonnement). Rend la session, ou null si rien n'est démarré. */
export async function startCovered(deps: AccountDeps, login: { token: string; entitlements: Entitlements }): Promise<StartedSession | null> {
  const { ui, api } = deps;
  const { entitlements, token } = login;

  if (!entitlements.freeOfferAvailable && !entitlements.subscription) {
    ui.info('Votre assistance offerte a déjà été utilisée. Pour continuer : abonnement de 10 000 FCFA par mois (agent IA ou technicien).');
    const pick = await ui.choose("Souhaitez-vous demander l'abonnement ?", ["Oui, demander l'abonnement", 'Non, plus tard']);
    if (pick === 0) {
      try {
        const sub = await api.subscribe(token);
        ui.info(`Demande enregistrée (référence ${sub.order.id.slice(0, 8)}, ${sub.order.amount_fcfa} FCFA). Après votre paiement Mobile Money et sa confirmation, relancez le programme.`);
      } catch (err) {
        ui.info(err instanceof Error ? err.message : "Impossible d'enregistrer la demande.");
      }
    }
    return null;
  }

  if (!entitlements.subscription) {
    const go = await ui.choose('Vous avez une assistance offerte. La démarrer maintenant ?', ['Oui, la démarrer', 'Non, plus tard']);
    if (go !== 0) return null;
  }

  try {
    const started = await api.startAssistance(token);
    return { token, sessionId: started.session.id, coverage: started.coverage, fallbackToHuman: started.fallbackToHuman };
  } catch (err) {
    ui.info(err instanceof Error ? err.message : "Impossible de démarrer l'assistance.");
    return null;
  }
}
