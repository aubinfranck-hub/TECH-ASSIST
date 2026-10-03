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
  /** Poste couvert par l'abonnement de la société. */
  companyCovered?: boolean;
  /** Forfait payé, pas encore démarré. */
  paidForfait?: { orderId: string; name: string; scope: Scope } | null;
  aiAgentAvailable: boolean;
}

export type Scope = 'diagnostic' | 'fix' | 'full';

/** Les forfaits à l'usage des particuliers (prix lus du serveur à l'affichage ; ceux-ci sont l'ordre et les libellés). */
export const FORFAITS: { planId: string; label: string; price: number; scope: Scope; text: string }[] = [
  { planId: 'diagnostic_express', label: 'Diagnostic', price: 500, scope: 'diagnostic', text: "j'analyse votre PC et je vous explique, sans rien modifier" },
  { planId: 'assistance_rapide', label: 'Dépannage', price: 2000, scope: 'fix', text: 'un problème précis réglé avec vous (Windows, Office, Outlook, imprimante, Wi-Fi…)' },
  { planId: 'session_maintenance', label: 'Intervention complète', price: 5000, scope: 'full', text: "analyse et réparation complètes, jusqu'à résolution, avec un technicien si besoin" },
];

export interface StartedSession {
  token: string;
  sessionId: string;
  scope: Scope;
  coverage: 'subscription' | 'company' | 'free_offer' | 'paid_forfait';
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
    return this.call<{ sent: boolean; verification?: boolean }>('/app/email-code', { email });
  }
  register(input: { installId: string; email: string; code?: string; phone?: string; name?: string; hardwareHash?: string }) {
    return this.call<{ token: string; entitlements: Entitlements }>('/app/register', { platform: 'windows', ...input });
  }
  me(token: string) {
    return this.call<{ email: string; entitlements: Entitlements }>('/app/me', null, token, 'GET');
  }
  startAssistance(token: string, orderId?: string) {
    return this.call<{
      session: { id: string };
      coverage: 'subscription' | 'company' | 'free_offer' | 'paid_forfait';
      scope?: Scope;
      fallbackToHuman: boolean;
    }>('/app/assistance', { mode: 'ia', ...(orderId ? { orderId } : {}) }, token);
  }
  orderForfait(token: string, planId: string) {
    return this.call<{
      order: { id: string; amount_fcfa: number };
      plan: { name: string; scope: Scope };
      payment: { amountFcfa: number; reference: string; instructions: string; url?: string | null; automatic?: boolean; methods?: string[] };
    }>('/app/orders', { planId }, token);
  }
  payOrder(token: string, id: string, method: string) {
    return this.call<{ url: string }>(`/app/orders/${encodeURIComponent(id)}/pay`, { method }, token);
  }
  orderStatus(token: string, id: string) {
    return this.call<{ order: { status: string; used: boolean } }>(`/app/orders/${encodeURIComponent(id)}`, null, token, 'GET');
  }
  joinCompany(token: string, code: string, deviceName: string) {
    return this.call<{ companyName: string }>('/app/company/join', { code, deviceName }, token);
  }
  async heartbeat(token: string, health: Record<string, number | boolean>): Promise<boolean> {
    try {
      await this.call('/app/company/heartbeat', health, token);
      return true;
    } catch {
      return false; // pas rattaché, ou serveur injoignable : sans importance pour le client
    }
  }
  async pendingRequest(token: string): Promise<{ id: string; kind?: 'diagnostic' | 'repair'; companyName: string } | null> {
    try {
      const r = await this.call<{ request: { id: string; kind?: 'diagnostic' | 'repair'; companyName: string } | null }>('/app/company/requests', null, token, 'GET');
      return r.request;
    } catch {
      return null;
    }
  }
  answerRequest(token: string, id: string, body: { status: 'done' | 'declined'; worst?: string; summary?: string }) {
    return this.call<{ ok: boolean }>(`/app/company/requests/${encodeURIComponent(id)}/answer`, body, token);
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

  ui.info("Pour commencer, j'ai besoin de votre adresse email (c'est ce qui vous donne droit à votre assistance offerte).");
  const email = (
    await askValid(ui, 'Quelle est votre adresse email ?', (v) => EMAIL.test(v), "Cette adresse n'a pas l'air valide. Exemple : nom@exemple.com")
  )?.toLowerCase();
  if (!email) return null;

  let verification = true;
  try {
    verification = (await api.requestCode(email)).verification !== false;
  } catch (err) {
    ui.info(err instanceof Error ? err.message : "Impossible d'envoyer le code.");
    return null;
  }
  if (verification) ui.info(`Un code à 6 chiffres vient d'être envoyé à ${email}. Pensez à regarder les courriers indésirables.`);

  let phone: string | undefined;
  if (verification) {
    const phoneAnswer = await askValid(
      ui,
      'Votre numéro de téléphone (pour que nous puissions vous joindre) :',
      (v) => PHONE.test(v.replace(/[\s.-]/g, '')),
      'Numéro invalide : 8 à 15 chiffres, avec ou sans +.',
    );
    if (!phoneAnswer) return null;
    phone = phoneAnswer.replace(/[\s.-]/g, '');
  }

  if (!verification) {
    try {
      const result = await api.register({ installId: saved.installId, email, phone, hardwareHash: deps.hardwareHash });
      store.save({ installId: saved.installId, token: result.token, email });
      return { token: result.token, entitlements: result.entitlements };
    } catch (err) {
      ui.info(err instanceof Error ? err.message : 'Inscription impossible.');
      return null;
    }
  }

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

const METHOD_LABELS: Record<string, string> = { wave: 'Wave', orange: 'Orange Money', mtn: 'MTN Mobile Money', moov: 'Moov Money', djamo: 'Djamo' };

const fcfa = (n: number) => `${n.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')} FCFA`;

export interface StartDeps extends AccountDeps {
  /** Attente entre deux vérifications du paiement (tests : instantanée). */
  wait?: (ms: number) => Promise<void>;
  pollMs?: number;
  /** Durée maximale d'attente du paiement avant de rendre la main. */
  maxWaitMs?: number;
  /** Ouvre le lien de paiement dans le navigateur (absent : le lien est seulement affiché). */
  openUrl?: (url: string) => void;
}

/**
 * Démarre l'assistance : abonnement ou entreprise, forfait déjà payé, assistance offerte — sinon le client choisit
 * un forfait (500 / 2 000 / 5 000 FCFA), paie par Mobile Money, et l'assistance démarre dès la confirmation.
 */
export async function startCovered(deps: StartDeps, login: { token: string; entitlements: Entitlements }): Promise<StartedSession | null> {
  const { ui, api } = deps;
  const { entitlements, token } = login;

  const begin = async (orderId?: string, fallbackScope: Scope = 'full'): Promise<StartedSession | null> => {
    try {
      const started = await api.startAssistance(token, orderId);
      return { token, sessionId: started.session.id, scope: started.scope ?? fallbackScope, coverage: started.coverage, fallbackToHuman: started.fallbackToHuman };
    } catch (err) {
      ui.info(err instanceof Error ? err.message : "Impossible de démarrer l'assistance.");
      return null;
    }
  };

  // Abonnement ou entreprise : tout est couvert, aucune question.
  if (entitlements.subscription || entitlements.companyCovered) return begin();

  // Forfait déjà payé mais pas encore utilisé (programme fermé entre-temps).
  if (entitlements.paidForfait) {
    ui.info(`Votre forfait « ${entitlements.paidForfait.name} » est payé : je démarre votre assistance.`);
    return begin(entitlements.paidForfait.orderId, entitlements.paidForfait.scope);
  }

  if (entitlements.freeOfferAvailable) {
    const go = await ui.choose('Vous avez une assistance offerte. La démarrer maintenant ?', ['Oui, la démarrer', 'Non, plus tard']);
    if (go !== 0) return null;
    return begin(undefined, 'fix');
  }

  ui.info('Votre assistance offerte a déjà été utilisée. Choisissez le forfait qui correspond à votre besoin, vous ne payez que ce que vous utilisez :');
  const options = FORFAITS.map((f) => `${f.label} — ${fcfa(f.price)} : ${f.text}`);
  const pick = await ui.choose('Quel forfait souhaitez-vous ?', [...options, 'Plus tard']);
  if (pick === null || pick >= FORFAITS.length) return null;
  const forfait = FORFAITS[pick]!;

  let ordered;
  try {
    ordered = await api.orderForfait(token, forfait.planId);
  } catch (err) {
    ui.info(err instanceof Error ? err.message : 'Impossible de créer votre commande.');
    return null;
  }
  ui.info(`Forfait « ${ordered.plan.name} » : ${fcfa(ordered.payment.amountFcfa)}. Référence de paiement : ${ordered.payment.reference}.`);
  let payUrl = ordered.payment.url ?? null;
  if (ordered.payment.automatic && !payUrl && ordered.payment.methods?.length) {
    const labels = ordered.payment.methods.map((m) => METHOD_LABELS[m] ?? m);
    const choice = await ui.choose('Comment voulez-vous payer ?', [...labels, 'Plus tard']);
    if (choice === null || choice >= labels.length) return null;
    try {
      payUrl = (await api.payOrder(token, ordered.order.id, ordered.payment.methods[choice]!)).url;
    } catch (err) {
      ui.info(err instanceof Error ? err.message : 'Impossible de préparer le paiement.');
      return null;
    }
  }
  if (ordered.payment.automatic && payUrl) {
    ordered.payment.url = payUrl;
    ui.info(`Payez en toute sécurité ici : ${ordered.payment.url}`);
    ui.info("Dès que votre paiement est reçu, votre assistance démarre toute seule, sans rien d'autre à faire. Laissez cette fenêtre ouverte.");
    deps.openUrl?.(ordered.payment.url);
  } else {
    ui.info(ordered.payment.instructions);
    ui.info("J'attends la confirmation de votre paiement par un technicien. Vous pouvez laisser cette fenêtre ouverte.");
  }

  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = deps.pollMs ?? 10_000;
  const maxWait = deps.maxWaitMs ?? 15 * 60_000;
  for (let waited = 0; waited <= maxWait; waited += pollMs) {
    try {
      const status = await api.orderStatus(token, ordered.order.id);
      if (status.order.status === 'paid') {
        ui.info('Paiement confirmé, merci. Je démarre votre assistance.');
        return begin(ordered.order.id, ordered.plan.scope);
      }
    } catch {
      // réseau instable : on réessaie au prochain tour
    }
    await wait(pollMs);
  }
  ui.info('Je n\'ai pas encore reçu la confirmation de votre paiement. Relancez le programme une fois payé : votre forfait sera retrouvé automatiquement.');
  return null;
}


export type JoinResult = { ok: true; companyName: string } | { ok: false; error: string };

/** Rattache ce PC à l'entreprise du code ; les erreurs du serveur sont renvoyées telles quelles (déjà en français). */
export async function joinCompany(api: AppApi, token: string, code: string, deviceName: string): Promise<JoinResult> {
  try {
    const res = await api.joinCompany(token, code, deviceName);
    return { ok: true, companyName: res.companyName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Rattachement impossible.' };
  }
}

const WORST_ORDER = ['critical', 'fixable', 'watch', 'unknown', 'ok'] as const;

/**
 * Demande de diagnostic de l'entreprise : lecture seule. L'utilisateur du PC voit qui demande et ce qui sera envoyé,
 * puis accepte ou refuse. Seul un résumé (une ligne par domaine) est transmis, jamais de fichier.
 */
export async function answerCompanyRequest(
  deps: { ui: import('./types.js').ConversationUi; api: AppApi; runner: import('./types.js').CommandRunner; reporter?: import('./types.js').Reporter; machine?: string },
  token: string,
): Promise<'none' | 'done' | 'declined'> {
  const req = await deps.api.pendingRequest(token);
  if (!req) return 'none';
  const repair = req.kind === 'repair';
  const pick = await deps.ui.choose(
    repair
      ? `${req.companyName} demande de réparer ce PC (« Réparer mon PC »). Je commence par analyser ; ensuite, chaque correction vous est expliquée et ne se fait qu'avec votre accord. Vos documents ne sont jamais touchés. Un résumé sera envoyé à l'entreprise. Acceptez-vous ?`
      : `${req.companyName} demande un diagnostic de ce PC. Rien ne sera modifié ; un résumé (disque, sécurité, démarrage, performances…) lui sera envoyé. Acceptez-vous ?`,
    [repair ? 'Oui, réparer' : 'Oui, lancer le diagnostic', 'Non'],
  );
  try {
    if (pick !== 0) {
      await deps.api.answerRequest(token, req.id, { status: 'declined' });
      deps.ui.info('Demande refusée. Rien n’a été modifié ni envoyé.');
      return 'declined';
    }
    const { scanPc, formatFindings, repairMyPc } = await import('./repairPc.js');
    let summary: string;
    let worst: (typeof WORST_ORDER)[number];
    if (repair) {
      const noop = { async report() {} } as unknown as import('./types.js').Reporter;
      const out = await repairMyPc({ runner: deps.runner, ui: deps.ui, reporter: deps.reporter ?? noop, machine: deps.machine ?? 'PC' });
      const label = { nothing_to_fix: 'Rien à corriger', declined: 'Réparation refusée par l’utilisateur', repaired: 'Réparé', partial: 'Réparé en partie (un technicien peut être nécessaire)' }[out.status];
      const findings = 'after' in out ? out.after : out.findings;
      summary = `${label}${'actionsDone' in out ? ` — ${out.actionsDone.length} action(s)` : ''}\n${formatFindings(findings)}`;
      worst = WORST_ORDER.find((s) => findings.some((f) => f.severity === s)) ?? 'ok';
    } else {
      deps.ui.info('Diagnostic en cours (lecture seule)…');
      const findings = await scanPc(deps.runner);
      summary = formatFindings(findings);
      worst = WORST_ORDER.find((s) => findings.some((f) => f.severity === s)) ?? 'ok';
    }
    await deps.api.answerRequest(token, req.id, { status: 'done', worst, summary: summary.slice(0, 3000) });
    deps.ui.info(`Résumé envoyé à ${req.companyName}.`);
    return 'done';
  } catch (err) {
    deps.ui.info(err instanceof Error ? err.message : 'La demande de l’entreprise n’a pas pu être traitée.');
    return 'none';
  }
}
