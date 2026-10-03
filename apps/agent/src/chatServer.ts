import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MAX_ATTACHMENT_CHARS, type Attachment } from './assistant.js';
import { HUMAN_REQUEST_TEXT } from './humanAccess.js';
import type { ResultsView } from './results.js';
import type { TaskInfo, TaskResult, TaskTracker } from './tasks.js';
import type { Action, ConversationUi } from './types.js';

/**
 * Écran de conversation : une page de chat servie UNIQUEMENT sur cet ordinateur (127.0.0.1), ouverte
 * dans le navigateur du client. Le client y lit l'agent, répond, autorise ou refuse chaque action.
 *
 * Protections : écoute en local seulement, jeton aléatoire dans l'adresse, en-tête Host contrôlé
 * (contre le « DNS rebinding »), Origin contrôlé sur les envois, taille des envois limitée, page
 * sans ressource externe et texte affiché sans interprétation HTML.
 */

type ChatEvent =
  | { seq: number; type: 'say'; text: string }
  | { seq: number; type: 'tech'; name: string; text: string }
  | { seq: number; type: 'user'; text: string }
  | { seq: number; type: 'ask'; id: string; text: string }
  | { seq: number; type: 'confirm'; id: string; title: string; text: string; yes: string; no: string }
  | { seq: number; type: 'choose'; id: string; text: string; options: string[] }
  | { seq: number; type: 'resolved'; id: string }
  | { seq: number; type: 'step'; n: number }
  | { seq: number; type: 'tasks'; items: TaskView[]; now: number; complete: boolean }
  | { seq: number; type: 'results'; view: ResultsView }
  | { seq: number; type: 'ended'; text: string };

/** Une tâche telle que la fenêtre l'affiche ; les durées (min, max) sont en secondes, les dates en millisecondes. */
export interface TaskView {
  id: string;
  title: string;
  state: 'pending' | 'running' | TaskResult;
  min: number;
  max: number;
  startedAt?: number;
  /** Durée réelle, une fois la tâche terminée. */
  seconds?: number;
}

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type NewEvent = DistOmit<ChatEvent, 'seq'>;
type PromptEvent = DistOmit<Extract<ChatEvent, { type: 'ask' | 'confirm' | 'choose' }>, 'seq' | 'id'>;

interface Pending {
  kind: 'ask' | 'confirm' | 'choose';
  options?: string[];
  labels?: { yes: string; no: string };
  resolve: (value: string | boolean | number | null) => void;
}

const MAX_BODY = 10_000;
const MAX_TEXT = 2_000;
/** Une capture d'écran réduite par la page tient largement en 1 Mo ; au-delà, le corps est refusé. */
const MAX_ATTACH_BODY = 1_000_000;

/** Le type annoncé doit correspondre à la signature réelle du fichier (JPEG « FF D8 FF », PNG « 89 50 4E 47 »). */
export function validAttachment(value: unknown): Attachment | null {
  if (!value || typeof value !== 'object') return null;
  const { mime, data } = value as { mime?: unknown; data?: unknown };
  if ((mime !== 'image/png' && mime !== 'image/jpeg') || typeof data !== 'string') return null;
  if (data.length === 0 || data.length > MAX_ATTACHMENT_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  const head = Buffer.from(data.slice(0, 16), 'base64');
  const jpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const png = head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  return (mime === 'image/jpeg' ? jpeg : png) ? { mime, data } : null;
}

/** Diapositive affichée pendant que l'agent travaille. Le contenu vient du site (slides.json) : modifiable sans nouvelle version du programme. */
export interface Slide {
  title: string;
  text: string;
  /** Chemin d'une image du site, ex. /img/hero.jpg */
  image?: string;
  /** Petites vignettes (ex. nos métiers). */
  items?: { image: string; label: string }[];
}

const IMAGE_PATH = /^\/img\/[A-Za-z0-9._-]{1,60}\.(jpg|jpeg|png|webp)$/;
const MAX_SLIDES = 10;
const MAX_IMAGE_BYTES = 800_000;
export const DEFAULT_SITE = 'https://tech-assist-web.onrender.com';

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null);

/** Ne garde que des diapositives bien formées : texte court, images du site uniquement. Tout le reste est ignoré. */
export function parseSlides(json: unknown): Slide[] {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' && Array.isArray((json as { slides?: unknown }).slides) ? (json as { slides: unknown[] }).slides : [];
  const out: Slide[] = [];
  for (const raw of list.slice(0, MAX_SLIDES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const title = str(r.title, 120);
    const text = typeof r.text === 'string' && r.text.length <= 280 ? r.text.trim() : '';
    if (!title) continue;
    const slide: Slide = { title, text };
    if (typeof r.image === 'string' && IMAGE_PATH.test(r.image)) slide.image = r.image;
    if (Array.isArray(r.items)) {
      const items = r.items
        .slice(0, 4)
        .map((i) => (i && typeof i === 'object' ? (i as Record<string, unknown>) : null))
        .filter((i): i is Record<string, unknown> => !!i && typeof i.image === 'string' && IMAGE_PATH.test(i.image) && !!str(i.label, 40))
        .map((i) => ({ image: i.image as string, label: (i.label as string).trim() }));
      if (items.length > 0) slide.items = items;
    }
    out.push(slide);
  }
  return out;
}

/** Diapositives de secours (site injoignable) : texte seul, aucune image. */
export const FALLBACK_SLIDES: Slide[] = [
  { title: 'Tech Assist, votre technicien informatique', text: "Dépannage de PC, Internet, imprimante, Office, virus… à distance, depuis chez vous." },
  { title: 'Vos fichiers restent chez vous', text: 'Je ne touche jamais à vos documents, photos ni mots de passe. Tout ce que je fais est noté dans un rapport.' },
  { title: 'Une entreprise ? Un contrat pour tous vos PC', text: "Contrat mensuel pour votre parc d'ordinateurs : suivi, dépannage et rapports." },
];

const sha = (s: string) => createHash('sha256').update(s).digest();

export class ChatUi implements ConversationUi {
  /** Adresse à ouvrir dans le navigateur (contient le jeton). */
  url = '';
  /** Appelé quand le client demande un technicien. */
  onHandoff?: () => void;
  /** Appelé à chaque changement de l'état des tâches (sert à tenir le technicien au courant). */
  onTasks?: (snapshot: { items: TaskView[]; complete: boolean }) => void;

  private readonly log: ChatEvent[] = [];
  private seq = 0;
  private taskList: TaskView[] = [];
  /** La série de tâches est terminée pour de bon (l'agent a conclu), pas seulement entre deux tâches. */
  private tasksComplete = false;
  private readonly pending = new Map<string, Pending>();
  private readonly streams = new Set<ServerResponse>();
  private readonly token = randomBytes(24).toString('hex');
  private server!: Server;
  private port = 0;
  private closed = false;
  private handoff = false;
  private counter = 0;
  private attachment: Attachment | null = null;
  private site = DEFAULT_SITE;
  private fetchImpl: typeof fetch = fetch;
  private slidesCache: { at: number; slides: Slide[] } | null = null;
  /** La fenêtre du client est fermée : plus aucune question n'est posée, la conversation se termine d'elle-même. */
  private abandoned = false;
  private windowTimer: NodeJS.Timeout | null = null;
  private graceMs = 60_000;
  /** Appelé une fois quand la fenêtre a été fermée (le programme n'a plus de fenêtre : il doit s'arrêter, sans rester caché). */
  onWindowClosed?: () => void;
  private readonly imageCache = new Map<string, { at: number; type: string; body: Buffer }>();

  static async start(options: { port?: number; site?: string; fetchImpl?: typeof fetch; openWaitMs?: number; graceMs?: number } = {}): Promise<ChatUi> {
    const ui = new ChatUi();
    if (options.graceMs !== undefined) ui.graceMs = options.graceMs;
    if (options.site) ui.site = options.site.replace(/\/$/, '');
    if (options.fetchImpl) ui.fetchImpl = options.fetchImpl;
    ui.server = createServer((req, res) => ui.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      ui.server.once('error', reject);
      ui.server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
    });
    ui.port = (ui.server.address() as AddressInfo).port;
    ui.url = `http://127.0.0.1:${ui.port}/?t=${ui.token}`;
    // Si aucune fenêtre ne s'ouvre (navigateur introuvable…), le programme ne reste pas caché indéfiniment.
    ui.watchWindow(options.openWaitMs ?? 120_000);
    return ui;
  }

  // --- Interface de conversation ---

  info(message: string): void {
    this.push({ type: 'say', text: message });
  }

  confirmAction(action: Action): Promise<boolean> {
    const text = action.requiresAdmin ? `${action.explanation}\n\n(Cette action nécessite les droits administrateur.)` : action.explanation;
    return this.prompt<boolean>(
      { type: 'confirm', title: action.title, text, yes: 'Autoriser', no: 'Refuser' },
      { kind: 'confirm', labels: { yes: 'Autoriser', no: 'Refuser' } },
      false,
    );
  }

  confirmFixed(question: string): Promise<boolean> {
    return this.prompt<boolean>(
      { type: 'confirm', title: '', text: question, yes: 'Oui', no: 'Non' },
      { kind: 'confirm', labels: { yes: 'Oui', no: 'Non' } },
      false,
    );
  }

  ask(prompt: string): Promise<string | null> {
    // Une demande de technicien faite pendant que l'agent travaillait est transmise dès la prochaine question.
    if (this.technicianWanted && !this.closed && !this.handoff && !this.abandoned) {
      this.technicianWanted = false;
      this.push({ type: 'user', text: HUMAN_REQUEST_TEXT });
      return Promise.resolve(HUMAN_REQUEST_TEXT);
    }
    return this.prompt<string | null>({ type: 'ask', text: prompt }, { kind: 'ask' }, null);
  }

  choose(question: string, options: string[]): Promise<number | null> {
    return this.prompt<number | null>({ type: 'choose', text: question, options }, { kind: 'choose', options }, null);
  }

  /**
   * Suivi des tâches : l'agent annonce chaque tâche (début, fin) et la fenêtre affiche la tâche en cours, son temps écoulé
   * et sa durée habituelle. La série reste affichée jusqu'à ce que l'agent la conclue (`settle`) ; la suivante la remplace.
   */
  readonly tasks: TaskTracker = {
    plan: (items: TaskInfo[]) => {
      this.freshBatch();
      for (const i of items) if (!this.taskList.some((t) => t.id === i.id)) this.taskList.push({ id: i.id, title: i.title, state: 'pending', min: i.min, max: i.max });
      this.publishTasks();
    },
    start: (item: TaskInfo) => {
      this.freshBatch();
      let t = this.taskList.find((x) => x.id === item.id);
      if (!t) {
        t = { id: item.id, title: item.title, state: 'pending', min: item.min, max: item.max };
        this.taskList.push(t);
      }
      t.state = 'running';
      t.startedAt = Date.now();
      delete t.seconds;
      this.publishTasks();
    },
    end: (id: string, result: TaskResult) => {
      const t = this.taskList.find((x) => x.id === id);
      if (!t) return;
      t.state = result;
      t.seconds = t.startedAt ? Math.max(0, (Date.now() - t.startedAt) / 1000) : 0;
      this.publishTasks();
    },
    settle: () => {
      if (this.taskList.length === 0) return;
      this.taskList = this.taskList.filter((t) => t.state !== 'pending');
      this.tasksComplete = this.taskList.length > 0 && this.taskList.every((t) => t.state !== 'running');
      this.publishTasks();
    },
  };

  /** Une série conclue par l'agent (`settle`) est remplacée dès que de nouvelles tâches arrivent. */
  private freshBatch() {
    if (this.tasksComplete) {
      this.taskList = [];
      this.tasksComplete = false;
    }
  }

  /** La fenêtre reçoit toujours l'état complet ; seul le dernier état est rejoué à une page rechargée. */
  private publishTasks() {
    if (this.closed) return;
    for (let i = this.log.length - 1; i >= 0; i--) if (this.log[i]!.type === 'tasks') this.log.splice(i, 1);
    this.push({ type: 'tasks', items: this.taskList.map((t) => ({ ...t })), now: Date.now(), complete: this.tasksComplete });
    try {
      this.onTasks?.({ items: this.taskList, complete: this.tasksComplete });
    } catch {
      /* le suivi côté serveur ne doit jamais gêner la fenêtre du client */
    }
  }

  /** Carte « Résultats » : ce qui a changé sur l'ordinateur, chiffré (avant → après). */
  results(view: ResultsView): void {
    if (this.closed) return;
    this.push({ type: 'results', view });
  }

  wasHandedOff(): boolean {
    return this.handoff;
  }

  fromTechnician(name: string, text: string): void {
    this.push({ type: 'tech', name: name.slice(0, 40), text });
  }

  /** Après un passage de main, la fenêtre reste ouverte pour discuter avec le technicien : les questions sont de nouveau possibles. */
  resumeAfterHandoff(): void {
    this.handoff = false;
  }

  /** Étape affichée en haut de la fenêtre : 1 coordonnées, 2 demande, 3 intervention, 4 tout est terminé. */
  progress(step: 1 | 2 | 3 | 4): void {
    if (this.closed) return;
    this.push({ type: 'step', n: step });
  }

  /** La dernière capture jointe, une seule fois : elle n'est ni conservée ni renvoyée ensuite. */
  takeAttachment(): Attachment | null {
    const a = this.attachment;
    this.attachment = null;
    return a;
  }

  /**
   * Un technicien fait-il partie de l'offre du client ? Non (offre « Assistance IA ») : le bouton ne ferme pas la conversation ;
   * la demande est transmise à l'agent comme si le client l'avait écrite, et c'est lui qui propose le complément.
   */
  technicianIncluded: () => boolean = () => true;

  /** Le client a demandé un technicien pendant que l'agent travaillait (offre sans technicien) : à transmettre à la prochaine question. */
  private technicianWanted = false;

  /** Le client demande un technicien : toutes les questions en attente sont closes, la conversation s'arrête. */
  requestHandoff(): void {
    if (this.handoff || this.closed) return;
    if (!this.technicianIncluded()) {
      this.requestTechnicianThroughAgent();
      return;
    }
    this.handoff = true;
    this.push({ type: 'say', text: 'Je préviens un technicien…' });
    this.settleAll();
    this.onHandoff?.();
  }

  private requestTechnicianThroughAgent(): void {
    for (const [id, p] of this.pending) {
      if (p.kind === 'ask') {
        this.reply(id, HUMAN_REQUEST_TEXT);
        return;
      }
    }
    this.technicianWanted = true;
    this.push({ type: 'say', text: "Je note votre demande de technicien : je m'en occupe dès que j'ai terminé ce point." });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.windowTimer) clearTimeout(this.windowTimer);
    this.settleAll();
    this.push({ type: 'ended', text: 'Conversation terminée. Vous pouvez fermer cette page.' });
    for (const stream of this.streams) stream.end();
    this.streams.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // --- Diapositives ---

  /** Diapositives du site (cache 30 min) ; en cas d'échec ou de contenu invalide, celles de secours. */
  async loadSlides(): Promise<Slide[]> {
    if (this.slidesCache && Date.now() - this.slidesCache.at < 30 * 60_000) return this.slidesCache.slides;
    let slides: Slide[] = [];
    try {
      const res = await this.fetchImpl(`${this.site}/slides.json`, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
      if (res.ok && String(res.headers.get('content-type') ?? '').includes('json')) slides = parseSlides(await res.json());
    } catch {
      slides = [];
    }
    if (slides.length === 0) slides = FALLBACK_SLIDES;
    this.slidesCache = { at: Date.now(), slides };
    return slides;
  }

  /** Image du site, relayée par l'agent (la page n'appelle jamais d'autre adresse que 127.0.0.1). */
  async loadImage(path: string): Promise<{ type: string; body: Buffer } | null> {
    if (!IMAGE_PATH.test(path)) return null;
    const hit = this.imageCache.get(path);
    if (hit && Date.now() - hit.at < 60 * 60_000) return hit;
    try {
      const res = await this.fetchImpl(`${this.site}${path}`, { signal: AbortSignal.timeout(5000) });
      const type = String(res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0 || body.length > MAX_IMAGE_BYTES) return null;
      const entry = { at: Date.now(), type, body };
      this.imageCache.set(path, entry);
      return entry;
    } catch {
      return null;
    }
  }

  // --- Interne ---

  /** Surveille la fenêtre : sans connexion pendant `ms`, elle est considérée fermée. */
  private watchWindow(ms: number) {
    if (this.windowTimer) clearTimeout(this.windowTimer);
    if (this.closed) return;
    this.windowTimer = setTimeout(() => {
      this.windowTimer = null;
      if (this.closed || this.streams.size > 0) return;
      this.abandon();
    }, ms);
    this.windowTimer.unref();
  }

  /** Fenêtre fermée : les questions en attente sont closes (le client ne répondra plus) et plus aucune n'est posée. */
  private abandon() {
    if (this.abandoned) return;
    this.abandoned = true;
    this.settleAll();
    this.onWindowClosed?.();
  }

  private push(event: NewEvent): ChatEvent {
    const full = { ...event, seq: ++this.seq } as ChatEvent;
    this.log.push(full);
    for (const stream of this.streams) this.write(stream, full);
    return full;
  }

  private write(res: ServerResponse, event: ChatEvent) {
    res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private prompt<T>(event: PromptEvent, pending: Omit<Pending, 'resolve'>, fallback: T): Promise<T> {
    if (this.closed || this.handoff || this.abandoned) return Promise.resolve(fallback);
    const id = `p${++this.counter}`;
    return new Promise<T>((resolve) => {
      this.pending.set(id, { ...pending, resolve: resolve as Pending['resolve'] });
      this.push({ ...event, id } as NewEvent);
    });
  }

  private settleAll() {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.resolve(p.kind === 'confirm' ? false : null);
      this.push({ type: 'resolved', id });
    }
  }

  private reply(id: unknown, value: unknown): boolean {
    if (typeof id !== 'string') return false;
    const p = this.pending.get(id);
    if (!p) return false;

    let answer: string | boolean | number | null;
    let shown: string;
    if (p.kind === 'ask') {
      if (typeof value !== 'string') return false;
      answer = value.trim().slice(0, MAX_TEXT);
      shown = answer;
      if (!answer) return false;
    } else if (p.kind === 'confirm') {
      if (typeof value !== 'boolean') return false;
      answer = value;
      shown = value ? p.labels!.yes : p.labels!.no;
    } else {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= p.options!.length) return false;
      answer = value as number;
      shown = p.options![answer]!;
    }
    this.pending.delete(id);
    this.push({ type: 'user', text: shown });
    this.push({ type: 'resolved', id });
    p.resolve(answer);
    return true;
  }

  private authorized(req: IncomingMessage, url: URL): boolean {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return false;
    const given = url.searchParams.get('t') ?? '';
    return timingSafeEqual(sha(given), sha(this.token));
  }

  private handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (!this.authorized(req, url)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Accès refusé');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const nonce = randomBytes(16).toString('base64');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; img-src 'self'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      res.end(PAGE.replaceAll('__NONCE__', nonce));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/slides') {
      this.loadSlides().then(
        (slides) => res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ slides })),
        () => res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ slides: FALLBACK_SLIDES })),
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/slide-image') {
      this.loadImage(url.searchParams.get('p') ?? '').then((img) => {
        if (!img) return void res.writeHead(404).end();
        res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=3600' }).end(img.body);
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      const last = Number(req.headers['last-event-id'] ?? url.searchParams.get('last') ?? 0) || 0;
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      for (const event of this.log) if (event.seq > last) this.write(res, event);
      if (this.closed) return void res.end();
      this.streams.add(res);
      if (this.windowTimer) {
        clearTimeout(this.windowTimer);
        this.windowTimer = null;
      }
      req.on('close', () => {
        this.streams.delete(res);
        if (this.streams.size === 0 && !this.closed) this.watchWindow(this.graceMs);
      });
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/reply' || url.pathname === '/handoff' || url.pathname === '/attach')) {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://127.0.0.1:${this.port}` && origin !== `http://localhost:${this.port}`) {
        res.writeHead(403).end();
        return;
      }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        res.writeHead(415).end();
        return;
      }
      const maxBody = url.pathname === '/attach' ? MAX_ATTACH_BODY : MAX_BODY;
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > maxBody) {
          tooLarge = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        if (url.pathname === '/handoff') {
          this.requestHandoff();
          res.writeHead(204).end();
          return;
        }
        if (url.pathname === '/attach') {
          try {
            const valid = this.closed || this.handoff ? null : validAttachment(JSON.parse(body));
            if (!valid) return void res.writeHead(400).end();
            this.attachment = valid;
            this.push({ type: 'user', text: "📎 Capture d'écran jointe" });
            res.writeHead(204).end();
          } catch {
            res.writeHead(400).end();
          }
          return;
        }
        try {
          const parsed = JSON.parse(body) as { id?: unknown; value?: unknown };
          res.writeHead(this.reply(parsed.id, parsed.value) ? 204 : 409).end();
        } catch {
          res.writeHead(400).end();
        }
      });
      req.on('close', () => {
        if (tooLarge && !res.headersSent) res.writeHead(413).end();
      });
      return;
    }

    res.writeHead(404).end();
  }
}

/* Page de l'assistant. Identité visuelle commune à toute l'application : fenêtre en deux parties (photo de l'équipe et
   engagements à gauche, étapes et conversation à droite). Aucune ressource externe : les images du site sont relayées par l'agent. */
const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tech Assist — votre technicien informatique</title>
<style nonce="__NONCE__">
:root { --brand:#dc2626; --brand-dark:#b91c1c; --navy:#0b1326; --bg:#f3f5f9; --card:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --ok:#15803d; --no:#b91c1c; --shadow:0 1px 2px rgba(15,23,42,.06),0 8px 24px rgba(15,23,42,.07); }
* { box-sizing:border-box; }
html, body { height:100%; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; font:16px/1.55 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif; background:var(--bg); color:var(--ink); overflow:hidden; }
.sprite { position:absolute; width:0; height:0; overflow:hidden; }
.ic { width:20px; height:20px; flex:none; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.shell { height:100vh; height:100dvh; display:flex; flex-direction:column; }

/* Bandeau du haut */
.top { flex:none; height:76px; background:var(--card); border-bottom:1px solid var(--line); display:flex; align-items:center; gap:14px; padding:0 28px; position:relative; z-index:2; box-shadow:0 1px 0 rgba(15,23,42,.02); }
.brand { display:flex; align-items:center; gap:12px; min-width:0; }
.brand-mark { width:46px; height:46px; flex:none; }
.wordmark { font-size:1.75rem; font-weight:800; letter-spacing:-.035em; line-height:1; white-space:nowrap; }
.wordmark b { color:var(--brand); font-weight:800; }
.tag { font-size:.74rem; color:var(--muted); margin-top:4px; white-space:nowrap; }
.top .grow { flex:1; }
#handoff { display:inline-flex; align-items:center; gap:8px; background:transparent; color:var(--ink); border:1px solid var(--line); border-radius:999px; padding:9px 16px; font:inherit; font-size:.88rem; font-weight:600; cursor:pointer; white-space:nowrap; transition:border-color .15s,color .15s; }
#handoff:hover { border-color:var(--brand); color:var(--brand); }
#handoff .ic { width:18px; height:18px; }

.body { flex:1; min-height:0; display:grid; grid-template-columns:minmax(340px,31%) 1fr; }

/* Partie gauche : photo et engagements */
.side { position:relative; background:var(--navy); color:#fff; overflow:hidden; display:flex; flex-direction:column; justify-content:flex-end; }
.photo { position:absolute; left:0; right:0; top:0; height:66%; background:linear-gradient(160deg,#243049,#0b1326); }
.photo img { width:100%; height:100%; object-fit:cover; object-position:33% 22%; display:block; }
.photo::after { content:''; position:absolute; inset:0; background:linear-gradient(to bottom,rgba(11,19,38,0) 40%,var(--navy) 100%); }
.side-body { position:relative; padding:0 34px 30px; }
.side h2 { text-wrap:balance; margin:0 0 10px; font-size:clamp(1.7rem,2.5vw,2.4rem); line-height:1.08; letter-spacing:-.03em; font-weight:800; }
.side .lead { margin:0 0 22px; color:#cbd5e1; font-size:1rem; max-width:32ch; }
.points { list-style:none; margin:0; padding:0; display:grid; gap:14px; }
.points li { display:flex; gap:14px; align-items:center; }
.points .tile { width:46px; height:46px; border-radius:12px; display:grid; place-items:center; background:var(--brand); flex:none; }
.points .tile.alt { background:#334155; }
.points .tile .ic { width:24px; height:24px; color:#fff; }
.points strong { display:block; font-size:1rem; line-height:1.3; }
.points span { display:block; color:#a9b4c6; font-size:.88rem; line-height:1.35; }

/* Partie droite : étapes, conversation */
.stage { min-width:0; min-height:0; display:flex; flex-direction:column; gap:16px; padding:22px 32px 12px; background:linear-gradient(180deg,#ffffff 0,#f3f5f9 100%); }
.steps { flex:none; display:flex; width:100%; max-width:820px; margin:0 auto; }
.step { flex:1; position:relative; text-align:center; }
.dot { width:44px; height:44px; border-radius:50%; margin:0 auto 8px; display:grid; place-items:center; font-weight:700; background:#cbd5e1; color:#fff; position:relative; z-index:1; transition:background .25s,box-shadow .25s; }
.dot .ic { display:none; width:22px; height:22px; stroke-width:3; }
.step.current .dot { background:var(--brand); box-shadow:0 0 0 6px rgba(220,38,38,.14); }
.step.done .dot { background:var(--brand); }
.step.done .dot .ic { display:block; }
.step.done .dot .n { display:none; }
.step:not(:last-child)::after { content:''; position:absolute; top:21px; left:calc(50% + 30px); right:calc(-50% + 30px); height:3px; border-radius:2px; background:var(--line); transition:background .25s; }
.step.done:not(:last-child)::after { background:var(--brand); }
.step .t { font-weight:700; font-size:.95rem; line-height:1.25; color:#475569; }
.step.current .t, .step.done .t { color:var(--ink); }
.step .s { color:var(--muted); font-size:.82rem; line-height:1.3; }
/* Étape en cours : un anneau tourne autour du rond tant que l'agent travaille (il s'arrête quand il attend la réponse du client). */
@keyframes turn { to { transform:rotate(360deg); } }
.step.current .dot::before { content:''; position:absolute; inset:-7px; border-radius:50%; border:3px solid transparent; border-top-color:var(--brand); border-right-color:var(--brand); opacity:0; transition:opacity .2s; }
body.working .step.current .dot::before { opacity:1; animation:turn 1s linear infinite; }

/* Suivi de l'intervention : tâche en cours, temps écoulé, durée habituelle, reste approximatif */
.tasks { flex:none; width:100%; max-width:820px; margin:0 auto; background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow); padding:12px 16px; animation:rise .25s ease-out; }
.tasks[hidden] { display:none; }
.t-main { display:flex; align-items:center; gap:12px; }
.t-icon { flex:none; width:26px; height:26px; display:grid; place-items:center; }
.spin { display:inline-block; width:22px; height:22px; border-radius:50%; border:3px solid rgba(220,38,38,.18); border-top-color:var(--brand); animation:turn .9s linear infinite; }
.okdot { width:26px; height:26px; border-radius:50%; background:var(--ok); color:#fff; display:grid; place-items:center; font-weight:700; font-size:.9rem; }
.t-text { flex:1; min-width:0; }
.t-text strong { display:block; font-size:.98rem; line-height:1.3; overflow-wrap:anywhere; }
.t-text span { display:block; font-size:.84rem; color:var(--muted); line-height:1.35; }
.t-text span.late { color:#92400e; }
#t-toggle { flex:none; background:transparent; border:1px solid var(--line); border-radius:999px; padding:6px 12px; font:inherit; font-size:.8rem; font-weight:600; color:var(--ink); cursor:pointer; }
#t-toggle:hover { border-color:var(--brand); color:var(--brand); }
.t-bar { height:8px; margin:10px 0 6px; border-radius:99px; background:var(--line); overflow:hidden; }
.t-bar i { display:block; height:100%; width:0; border-radius:99px; background:linear-gradient(90deg,var(--brand),#f97316); transition:width .8s ease; }
.t-foot { display:flex; justify-content:space-between; gap:4px 14px; flex-wrap:wrap; font-size:.82rem; color:var(--muted); }
.t-list { list-style:none; margin:8px 0 0; padding:8px 0 0; border-top:1px solid var(--line); max-height:150px; overflow-y:auto; display:grid; gap:6px; }
.t-list[hidden] { display:none; }
.t-list li { display:flex; align-items:center; gap:10px; font-size:.88rem; }
.t-list .m { flex:none; width:18px; text-align:center; font-weight:700; display:grid; place-items:center; }
.t-list .ok .m { color:var(--ok); }
.t-list .ko .m { color:var(--no); }
.t-list .wait { color:var(--muted); }
.t-list .name { flex:1; min-width:0; overflow-wrap:anywhere; }
.t-list .when { flex:none; color:var(--muted); font-variant-numeric:tabular-nums; }
.t-list .spin { width:14px; height:14px; border-width:2px; }
/* Résultats de l'intervention : avant → après, mesuré */
.results { margin:16px 0; padding:16px 18px; border:1px solid #bbf7d0; background:linear-gradient(180deg,#f0fdf4,#fff); border-radius:18px; animation:rise .25s ease-out; }
.r-title { display:block; font-size:1.05rem; }
.r-head { margin:4px 0 10px; color:var(--muted); font-size:.9rem; }
.r-score { display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:10px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); margin-bottom:10px; }
.r-lab { font-weight:600; }
.r-nums { white-space:nowrap; }
.r-nums b { font-size:1.8rem; font-variant-numeric:tabular-nums; }
.r-nums small { color:var(--muted); margin-left:2px; }
.r-nums .r-from { color:var(--muted); }
.r-nums .r-arrow { margin:0 8px; font-style:normal; color:var(--muted); }
.r-nums .r-to.up { color:var(--ok); }
.r-rows, .r-acts { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
.r-acts { margin-top:10px; padding-top:10px; border-top:1px solid var(--line); }
.r-rows li { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:baseline; gap:2px 12px; font-size:.92rem; }
.r-rows .r-val { margin-left:auto; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.r-rows .r-chg { margin-left:6px; font-weight:700; color:var(--muted); }
.r-rows .better .r-chg { color:var(--ok); }
.r-rows .worse .r-chg { color:#92400e; }
.r-acts li { font-size:.9rem; overflow-wrap:anywhere; }
.r-acts .done::before { content:'✔ '; color:var(--ok); font-weight:700; }
.r-acts .failed::before { content:'✖ '; color:var(--no); font-weight:700; }
.r-acts .declined::before { content:'○ '; color:var(--muted); }
.r-acts b { font-weight:600; }
@media (prefers-reduced-motion: reduce) { .spin, body.working .step.current .dot::before { animation-duration:3s; } .t-bar i { transition:none; } }
.panel { flex:1; min-height:0; display:flex; flex-direction:column; width:100%; max-width:820px; margin:0 auto; background:var(--card); border:1px solid var(--line); border-radius:22px; box-shadow:var(--shadow); overflow:hidden; }
main { flex:1; min-height:0; overflow-y:auto; padding:18px 26px; }
.foot { flex:none; display:flex; justify-content:center; flex-wrap:wrap; gap:2px 18px; font-size:.8rem; color:var(--muted); }
.foot span::before { content:'✓ '; color:var(--ok); font-weight:700; }

/* Messages */
.msg { display:flex; gap:10px; margin:14px 0; align-items:flex-end; animation:rise .22s ease-out; }
.msg.from-user { justify-content:flex-end; }
.avatar { width:32px; height:32px; flex:none; }
.b { max-width:min(84%,560px); padding:11px 16px; border-radius:18px; white-space:pre-wrap; word-wrap:break-word; overflow-wrap:anywhere; }
.agent { background:#f1f5f9; border-bottom-left-radius:6px; }
.user { background:var(--brand); color:#fff; border-bottom-right-radius:6px; }
.tech { background:#0f172a; color:#fff; border-bottom-left-radius:6px; }
.tech .who { display:block; font-size:.74rem; font-weight:700; letter-spacing:.02em; color:#fca5a5; margin-bottom:2px; }
.note { text-align:center; color:var(--muted); font-size:.85rem; margin:18px 0; }
@keyframes rise { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
.welcome { text-align:center; padding:26px 8px 8px; }
.welcome .brand-mark { width:60px; height:60px; margin-bottom:10px; }
.welcome h2 { margin:0 0 4px; font-size:1.3rem; letter-spacing:-.02em; }
.welcome p { margin:0 auto; color:var(--muted); max-width:46ch; }
.typing { display:flex; gap:10px; margin:14px 0; align-items:center; color:var(--muted); font-size:.88rem; }
@keyframes blink { 0%,80%,100% { opacity:.25; } 40% { opacity:1; } }

/* Diapositives pendant le travail de l'agent */
.work { margin:14px 0; background:var(--card); border:1px solid var(--line); border-radius:18px; overflow:hidden; box-shadow:var(--shadow); animation:rise .3s ease-out; }
.work .status-line { display:flex; align-items:center; gap:8px; padding:10px 14px; font-size:.85rem; color:var(--muted); border-bottom:1px solid var(--line); }
.work .status-line i { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--brand); animation:blink 1.2s infinite ease-in-out; }
.work .stage-in { position:relative; overflow:hidden; }
.work .hero { width:100%; height:190px; object-fit:cover; object-position:100% 40%; display:block; background:var(--line); transform:scale(1.22); transform-origin:100% 40%; }
.work .body-in { position:relative; background:var(--card); padding:14px 16px 6px; }
.work h3 { margin:0 0 4px; font-size:1.08rem; letter-spacing:-.01em; }
.work .body-in p { margin:0; color:var(--muted); font-size:.93rem; }
.work .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:12px 16px 0; }
.work .grid figure { margin:0; border-radius:12px; overflow:hidden; border:1px solid var(--line); background:var(--bg); }
.work .grid img { width:100%; height:64px; object-fit:cover; display:block; }
.work .grid figcaption { padding:5px 8px; font-size:.78rem; font-weight:600; }
.work .dots { display:flex; justify-content:center; gap:7px; padding:10px 0 12px; }
.work .dots button { width:8px; height:8px; padding:0; border:0; border-radius:50%; background:var(--line); cursor:pointer; }
.work .dots button[aria-current=true] { background:var(--brand); width:20px; border-radius:99px; }
.work .dots button:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }

/* Zone de réponse */
#controls { flex:none; border-top:1px solid var(--line); background:#fbfcfe; padding:18px 26px 16px; max-height:62%; overflow-y:auto; }
#controls:empty { display:none; }
#controls h2 { margin:0 0 4px; font-size:1.02rem; letter-spacing:-.01em; }
#controls p { margin:0 0 12px; white-space:pre-wrap; color:var(--ink); font-weight:600; }
#controls h2 + p { color:var(--muted); font-weight:400; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 12px; }
.chips button { background:var(--card); color:var(--ink); border:1px solid var(--line); border-radius:999px; padding:8px 14px; font:inherit; font-size:.9rem; cursor:pointer; }
.chips button:hover { border-color:var(--brand); color:var(--brand); }
.row { display:flex; gap:10px; flex-wrap:wrap; }
button.act { flex:1; min-height:50px; display:inline-flex; align-items:center; justify-content:center; gap:10px; border:0; border-radius:12px; font:inherit; font-weight:700; cursor:pointer; background:var(--brand); color:#fff; padding:10px 18px; transition:filter .15s,transform .05s; }
button.act:hover { filter:brightness(.94); } button.act:active { transform:translateY(1px); }
button.yes { background:var(--ok); } button.no { background:transparent; color:var(--no); border:1px solid var(--no); }
button.opt { background:var(--card); color:var(--ink); border:1px solid var(--line); text-align:left; justify-content:flex-start; flex-basis:100%; font-weight:500; }
button.opt:hover { border-color:var(--brand); filter:none; }
button.act:focus-visible, #handoff:focus-visible, input:focus-visible, .attach button:focus-visible, .chips button:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
form { display:flex; gap:12px; flex-wrap:wrap; }
input[type=text] { flex:1; min-width:0; min-height:50px; padding:8px 14px; border-radius:12px; border:1px solid var(--line); font:inherit; background:var(--card); color:var(--ink); }
input[type=text]:focus { border-color:var(--brand); }
form button.act { flex:0 0 auto; min-width:170px; }
.code { display:flex; gap:12px; flex-basis:100%; }
.code input { flex:1; min-width:0; max-width:68px; height:64px; text-align:center; font:700 1.7rem "Segoe UI",system-ui,sans-serif; border:1.5px solid var(--line); border-radius:12px; background:var(--card); color:var(--ink); padding:0; }
.code input:focus { border-color:var(--brand); box-shadow:0 0 0 4px rgba(220,38,38,.14); }
.code + button.act { flex:1 1 100%; }
.attach { flex-basis:100%; font-size:.82rem; color:var(--muted); display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
.attach button { display:inline-flex; align-items:center; gap:6px; background:var(--card); border:1px solid var(--line); color:var(--ink); border-radius:999px; padding:6px 14px; font:inherit; font-size:.84rem; cursor:pointer; }
.attach button:hover { border-color:var(--brand); }
.attach .ic { width:16px; height:16px; }

@media (max-height:720px) { .side .lead { display:none; } .points { gap:10px; } .stage { gap:10px; padding-top:14px; } .dot { width:38px; height:38px; margin-bottom:4px; } .step:not(:last-child)::after { top:18px; } .step .s { display:none; } }
@media (max-width:900px) {
  .body { grid-template-columns:1fr; }
  .side { display:none; }
  .top { height:64px; padding:0 14px; }
  .tag { display:none; }
  .wordmark { font-size:1.4rem; }
  .brand-mark { width:38px; height:38px; }
  #handoff span { display:none; }
  .stage { padding:12px 10px 8px; gap:10px; }
  .step .s { display:none; }
  main { padding:12px 14px; }
  #controls { padding:14px; }
  form button.act { flex:1 1 100%; }
}
@media (prefers-reduced-motion: reduce) { .msg, .work { animation:none; } .work .status-line i { animation:none; } .dot, .step::after { transition:none; } }
</style>
</head>
<body>
<svg class="sprite" aria-hidden="true" focusable="false"><defs>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z"/><path d="M9 12l2.2 2.2L15.5 10"/></symbol>
<symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z"/></symbol>
<symbol id="i-person" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></symbol>
<symbol id="i-send" viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
<symbol id="i-clip" viewBox="0 0 24 24"><path d="M21 11.5l-8.6 8.6a5 5 0 01-7.1-7.1l8.6-8.6a3.3 3.3 0 014.7 4.7l-8.6 8.6a1.7 1.7 0 01-2.4-2.4l7.9-7.9"/></symbol>
<symbol id="i-headset" viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M19 20c0 1.2-1.5 2-4 2h-2"/></symbol>
</defs></svg>
<div class="sprite" aria-hidden="true"><svg class="ic" id="ic-send"><use href="#i-send"/></svg><svg class="ic" id="ic-clip"><use href="#i-clip"/></svg></div>
<div class="shell">
<header class="top">
<div class="brand">
<svg class="brand-mark" viewBox="0 0 120 120" aria-hidden="true"><rect x="4" y="4" width="112" height="112" rx="28" fill="#dc2626"/><text x="60" y="79" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="58" font-weight="900" letter-spacing="-5">TA</text></svg>
<div><div class="wordmark">Tech<b>Assist</b></div><div class="tag">Votre technicien informatique, à distance</div></div>
</div>
<div class="grow"></div>
<button id="handoff" type="button"><svg class="ic" aria-hidden="true"><use href="#i-headset"/></svg><span>Parler à un technicien</span></button>
</header>
<div class="body">
<aside class="side" aria-label="Nos engagements">
<div class="photo" id="photo"></div>
<div class="side-body">
<h2>Un technicien à vos côtés</h2>
<p class="lead">Je règle les problèmes de votre ordinateur avec vous, simplement et en toute sécurité.</p>
<ul class="points">
<li><span class="tile"><svg class="ic" aria-hidden="true"><use href="#i-shield"/></svg></span><div><strong>Vos fichiers restent privés</strong><span>Jamais vos documents, photos ni mots de passe</span></div></li>
<li><span class="tile alt"><svg class="ic" aria-hidden="true"><use href="#i-bolt"/></svg></span><div><strong>Diagnostic en quelques minutes</strong><span>Je cherche la cause, je corrige, je vérifie</span></div></li>
<li><span class="tile"><svg class="ic" aria-hidden="true"><use href="#i-person"/></svg></span><div><strong>Une équipe d'Abidjan</strong><span>Un technicien prend le relais si besoin</span></div></li>
</ul>
</div>
</aside>
<section class="stage">
<nav class="steps" aria-label="Progression">
<div class="step current" aria-current="step"><div class="dot"><span class="n">1</span><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg></div><div class="t">Vos coordonnées</div><div class="s">Email et téléphone</div></div>
<div class="step"><div class="dot"><span class="n">2</span><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg></div><div class="t">Votre demande</div><div class="s">Accord et problème à régler</div></div>
<div class="step"><div class="dot"><span class="n">3</span><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg></div><div class="t">Intervention</div><div class="s">Analyse et correction</div></div>
</nav>
<section class="tasks" id="tasks" hidden aria-label="Suivi de l'intervention">
<div class="t-main"><span class="t-icon" id="t-icon" aria-hidden="true"></span><div class="t-text"><strong id="t-title" aria-live="polite"></strong><span id="t-meta"></span></div><button type="button" id="t-toggle" aria-expanded="false">Voir le détail</button></div>
<div class="t-bar" id="t-bar" role="progressbar" aria-label="Avancement de l'intervention" aria-valuemin="0" aria-valuemax="100"><i id="t-fill"></i></div>
<div class="t-foot" id="t-foot"></div>
<ul class="t-list" id="t-list" hidden></ul>
</section>
<div class="panel">
<main id="log" aria-live="polite">
<div class="welcome" id="welcome">
<h2>Bonjour, je suis AI PC</h2><p>Je m'occupe de tout : je cherche la cause, je corrige, puis je vérifie. Vous n'avez qu'à répondre aux questions.</p>
</div>
</main>
<section id="controls" aria-label="Votre réponse"></section>
</div>
<div class="foot"><span>Reste sur votre PC</span><span>Tout est noté</span><span>Arrêt à tout moment</span></div>
</section>
</div>
</div>
<script nonce="__NONCE__">
(function () {
  var token = new URLSearchParams(location.search).get('t') || '';
  var log = document.getElementById('log');
  var controls = document.getElementById('controls');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  /* Icône prête à l'emploi (copie d'une icône cachée de la page) : aucun HTML n'est jamais construit en script. */
  function icon(name) {
    var n = document.getElementById('ic-' + name).cloneNode(true);
    n.removeAttribute('id');
    return n;
  }
  function scrollDown() { log.scrollTop = log.scrollHeight; }
  /* Logo : copie du logo du bandeau. */
  function avatar() {
    var svg = document.querySelector('.top .brand-mark').cloneNode(true);
    svg.setAttribute('class', 'avatar');
    return svg;
  }
  function img(cls, path) {
    var i = el('img', cls); i.alt = ''; i.decoding = 'async';
    i.src = '/slide-image?p=' + encodeURIComponent(path) + '&t=' + encodeURIComponent(token);
    i.onerror = function () { i.style.display = 'none'; };
    return i;
  }
  /* Photo de l'équipe à gauche : image du site, relayée par l'agent ; sans elle, un fond sobre. */
  document.getElementById('photo').appendChild(img('', '/img/hero.jpg'));
  /* Les trois étapes : 1 coordonnées, 2 demande, 3 intervention, 4 = tout est terminé. */
  function setStep(n) {
    Array.prototype.forEach.call(document.querySelectorAll('.step'), function (s, k) {
      var num = k + 1;
      s.className = 'step' + (num < n ? ' done' : num === n ? ' current' : '');
      if (num === n) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current');
    });
  }
  /* Suivi de l'intervention : tâche en cours, temps écoulé, durée habituelle, temps restant approximatif. */
  var tBox = document.getElementById('tasks'), tIcon = document.getElementById('t-icon'), tTitle = document.getElementById('t-title'), tMeta = document.getElementById('t-meta');
  var tFill = document.getElementById('t-fill'), tBar = document.getElementById('t-bar'), tFoot = document.getElementById('t-foot'), tList = document.getElementById('t-list'), tToggle = document.getElementById('t-toggle');
  var taskData = null, taskTick = null, detailOpen = false;
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + ' s';
    var m = Math.round(sec / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), r = m % 60;
    return r ? h + ' h ' + r : h + ' h';
  }
  function clock(sec) { sec = Math.max(0, Math.floor(sec)); var r = sec % 60; return Math.floor(sec / 60) + ':' + (r < 10 ? '0' : '') + r; }
  function range(a, b) {
    if (b < 60) return Math.round(a) + ' à ' + Math.round(b) + ' s';
    if (a >= 60) { var x = Math.round(a / 60), y = Math.round(b / 60); return x === y ? x + ' min' : x + ' à ' + y + ' min'; }
    return fmt(a) + ' à ' + fmt(b);
  }
  function renderTasks() {
    if (!taskData || !taskData.items.length) { tBox.hidden = true; return; }
    tBox.hidden = false;
    var items = taskData.items, now = Date.now() + taskData.offset;
    var counted = items.filter(function (t) { return t.state !== 'skipped'; });
    var running = null, pending = [], finished = [];
    counted.forEach(function (t) { if (t.state === 'running') running = t; else if (t.state === 'pending') pending.push(t); else finished.push(t); });
    function mid(t) { return (t.min + t.max) / 2; }
    var elapsed = running ? Math.max(0, (now - running.startedAt) / 1000) : 0;
    var total = 0, got = 0, lo = 0, hi = 0, spent = 0;
    counted.forEach(function (t) { total += mid(t); });
    finished.forEach(function (t) { got += mid(t); spent += t.seconds || 0; });
    pending.forEach(function (t) { lo += t.min; hi += t.max; });
    if (running) { got += Math.min(elapsed, mid(running) * 0.95); lo += Math.max(0, running.min - elapsed); hi += Math.max(0, running.max - elapsed); }
    var allDone = !running && pending.length === 0;
    var pct = allDone && taskData.complete ? 100 : allDone ? Math.min(97, Math.round(got / Math.max(total, 1) * 100)) : total > 0 ? Math.min(97, Math.round(got / total * 100)) : 0;
    tFill.style.width = pct + '%';
    tBar.setAttribute('aria-valuenow', String(pct));
    var late = !!running && elapsed > running.max;
    tIcon.replaceChildren(allDone ? el('span', 'okdot', '✓') : el('span', 'spin'));
    tMeta.className = '';
    if (running) {
      tTitle.textContent = running.title;
      tMeta.textContent = late ? "Cela prend plus de temps que d'habitude, c'est normal sur certains ordinateurs. Ne fermez pas cette fenêtre." : 'En cours depuis ' + clock(elapsed) + ' · durée habituelle : ' + range(running.min, running.max);
      if (late) tMeta.className = 'late';
    } else if (pending.length > 0) {
      tTitle.textContent = 'Prochaine tâche : ' + pending[0].title;
      tMeta.textContent = 'Durée habituelle : ' + range(pending[0].min, pending[0].max);
    } else {
      var failed = finished.filter(function (t) { return t.state === 'failed'; }).length;
      var count = counted.length + (counted.length > 1 ? ' tâches' : ' tâche') + (failed ? ' · ' + failed + (failed > 1 ? ' non réussies' : ' non réussie') : '');
      if (taskData.complete) { tTitle.textContent = 'Intervention terminée'; tMeta.textContent = count; }
      else { tTitle.textContent = finished[finished.length - 1].title + ' : terminé'; tMeta.textContent = 'La suite dépend de vos réponses · ' + count; }
    }
    var left = allDone ? (taskData.complete ? 'Durée totale : ' : 'Durée : ') + fmt(spent) : 'Tâche ' + Math.min(counted.length, finished.length + 1) + ' sur ' + counted.length;
    var right = allDone ? '' : hi < 60 ? "Il reste moins d'une minute" : 'Reste environ ' + range(lo, hi);
    tFoot.replaceChildren(el('span', '', left), el('span', '', right));
    tList.hidden = !detailOpen;
    if (detailOpen) {
      tList.replaceChildren();
      items.forEach(function (t) {
        var li = el('li', t.state === 'done' ? 'ok' : t.state === 'failed' ? 'ko' : t.state === 'running' ? 'run' : 'wait');
        var mark = el('span', 'm');
        if (t.state === 'running') mark.appendChild(el('span', 'spin')); else mark.textContent = t.state === 'done' ? '✓' : t.state === 'failed' ? '✗' : t.state === 'skipped' ? '–' : '○';
        var when = t.state === 'running' ? clock((now - t.startedAt) / 1000) + ' / ' + range(t.min, t.max) : t.state === 'done' || t.state === 'failed' ? fmt(t.seconds || 0) : t.state === 'skipped' ? 'inutile' : '≈ ' + range(t.min, t.max);
        li.appendChild(mark); li.appendChild(el('span', 'name', t.title)); li.appendChild(el('span', 'when', when));
        tList.appendChild(li);
      });
    }
    tToggle.textContent = detailOpen ? 'Masquer le détail' : 'Voir le détail';
    tToggle.setAttribute('aria-expanded', String(detailOpen));
  }
  tToggle.onclick = function () { detailOpen = !detailOpen; renderTasks(); };
  function setTasks(ev) {
    taskData = { items: ev.items, offset: ev.now - Date.now(), complete: !!ev.complete };
    renderTasks();
    var live = ev.items.some(function (t) { return t.state === 'running'; });
    if (live && !taskTick) taskTick = setInterval(renderTasks, 1000);
    if (!live && taskTick) { clearInterval(taskTick); taskTick = null; }
  }
  /* Résultats : score de santé avant → après, mesures chiffrées, effet de chaque action. */
  function showResults(v) {
    hideTyping();
    var card = el('div', 'results');
    card.appendChild(el('strong', 'r-title', "Résultats de l'intervention"));
    card.appendChild(el('p', 'r-head', v.headline));
    if (v.score) {
      var sc = el('div', 'r-score');
      sc.appendChild(el('span', 'r-lab', "Santé de l'ordinateur"));
      var nums = el('span', 'r-nums');
      nums.appendChild(el('b', 'r-from', String(v.score.before)));
      nums.appendChild(el('i', 'r-arrow', '→'));
      nums.appendChild(el('b', v.score.after > v.score.before ? 'r-to up' : 'r-to', String(v.score.after)));
      nums.appendChild(el('small', '', '/100'));
      sc.appendChild(nums);
      card.appendChild(sc);
    }
    if (v.rows.length) {
      var ul = el('ul', 'r-rows');
      v.rows.forEach(function (r) {
        var li = el('li', r.trend);
        li.appendChild(el('span', 'r-name', r.label));
        var val = el('span', 'r-val', r.before + ' → ' + r.after);
        if (r.trend !== 'same') val.appendChild(el('span', 'r-chg', r.change));
        li.appendChild(val);
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }
    var acts = v.actions.filter(function (a) { return a.effect || a.result !== 'done'; });
    if (acts.length) {
      var al = el('ul', 'r-acts');
      acts.forEach(function (a) {
        var li = el('li', a.result);
        li.appendChild(el('b', '', a.title));
        if (a.effect) li.appendChild(document.createTextNode(' : ' + a.effect));
        al.appendChild(li);
      });
      card.appendChild(al);
    }
    log.appendChild(card);
    scrollDown();
  }
  function bubble(cls, text, who) {
    var welcome = document.getElementById('welcome'); if (welcome) welcome.remove();
    hideTyping();
    if (cls === 'note') { log.appendChild(el('div', 'note', text)); }
    else {
      var row = el('div', 'msg from-' + cls);
      if (cls === 'agent' || cls === 'tech') row.appendChild(avatar());
      var b = el('div', 'b ' + cls);
      if (who) b.appendChild(el('span', 'who', who + ' · technicien Tech Assist'));
      b.appendChild(document.createTextNode(text));
      row.appendChild(b); log.appendChild(row);
    }
    scrollDown();
  }
  function post(path, body) {
    return fetch(path + '?t=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function clearControls() { controls.replaceChildren(); }
  /* Pendant que l'agent travaille : « Je travaille dessus… » puis, après un instant, des diapositives sur Tech Assist. */
  var typingEl = null, typingTimer = null, slideTimer = null, slidesData = null;
  fetch('/slides?t=' + encodeURIComponent(token)).then(function (r) { return r.json(); }).then(function (d) { slidesData = d.slides || []; }).catch(function () { slidesData = []; });
  function buildWork() {
    var card = el('div', 'work');
    var status = el('div', 'status-line'); status.appendChild(el('i')); status.appendChild(el('span', '', 'Je travaille sur votre ordinateur…')); card.appendChild(status);
    var stage = el('div', 'stage-in'); card.appendChild(stage);
    var dots = el('div', 'dots'); card.appendChild(dots);
    var slides = slidesData && slidesData.length ? slidesData : [];
    if (!slides.length) return card;
    var index = 0;
    function show(i) {
      index = (i + slides.length) % slides.length;
      var sl = slides[index];
      stage.replaceChildren();
      if (sl.image) stage.appendChild(img('hero', sl.image));
      var body = el('div', 'body-in'); body.appendChild(el('h3', '', sl.title)); if (sl.text) body.appendChild(el('p', '', sl.text)); stage.appendChild(body);
      if (sl.items && sl.items.length) {
        var grid = el('div', 'grid');
        sl.items.forEach(function (it) { var f = el('figure'); f.appendChild(img('', it.image)); f.appendChild(el('figcaption', '', it.label)); grid.appendChild(f); });
        stage.appendChild(grid);
      }
      Array.prototype.forEach.call(dots.children, function (d, k) { d.setAttribute('aria-current', String(k === index)); });
    }
    slides.forEach(function (_, k) {
      var d = el('button'); d.type = 'button'; d.setAttribute('aria-label', 'Diapositive ' + (k + 1));
      d.onclick = function () { show(k); restart(); }; dots.appendChild(d);
    });
    function restart() {
      clearInterval(slideTimer);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && slides.length > 1) slideTimer = setInterval(function () { show(index + 1); }, 7000);
    }
    show(0); restart();
    return card;
  }
  function showTyping() {
    if (typingEl || typingTimer) return;
    /* Pas de diapositives pour une réponse rapide : seulement si l'attente dure plus de 2 secondes. */
    typingTimer = setTimeout(function () {
      typingTimer = null;
      typingEl = buildWork(); log.appendChild(typingEl); scrollDown();
    }, 2000);
  }
  function hideTyping() {
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
    clearInterval(slideTimer);
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }
  function reply(id, value) { post('/reply', { id: id, value: value }); }
  /* Réduit la capture (1280 px, JPEG) dans le navigateur, puis l'envoie à l'agent local. */
  function sendImage(f, note) {
    if (!window.createImageBitmap) { note.textContent = "Ce navigateur ne peut pas joindre de capture."; return; }
    createImageBitmap(f).then(function (bmp) {
      var scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      c.toBlob(function (blob) {
        if (!blob) { note.textContent = "Capture illisible."; return; }
        var r = new FileReader();
        r.onload = function () {
          var data = String(r.result).split(',')[1] || '';
          post('/attach', { mime: 'image/jpeg', data: data }).then(function (res) { note.textContent = res.ok ? 'Capture jointe : elle sera envoyée avec votre prochain message.' : 'Capture refusée (trop lourde ?).'; });
        };
        r.readAsDataURL(blob);
      }, 'image/jpeg', 0.7);
    }).catch(function () { note.textContent = "Ce fichier n'est pas une image lisible."; });
  }
  function sendButton() {
    var send = el('button', 'act'); send.type = 'submit'; send.appendChild(icon('send')); send.appendChild(el('span', '', 'Envoyer'));
    return send;
  }
  /* Code reçu par email : six cases, une par chiffre (saisie, collage et retour arrière gérés). */
  function codeBoxes(onDone) {
    var wrap = el('div', 'code'); var boxes = [];
    function value() { return boxes.map(function (b) { return b.value; }).join(''); }
    for (var k = 0; k < 6; k++) {
      (function (k) {
        var b = el('input'); b.type = 'text'; b.inputMode = 'numeric'; b.maxLength = 1; b.autocomplete = 'one-time-code'; b.setAttribute('aria-label', 'Chiffre ' + (k + 1) + ' sur 6');
        b.oninput = function () {
          b.value = b.value.replace(/[^0-9]/g, '').slice(0, 1);
          if (b.value && k < 5) boxes[k + 1].focus();
        };
        b.onkeydown = function (e) {
          if (e.key === 'Backspace' && !b.value && k > 0) { boxes[k - 1].focus(); boxes[k - 1].value = ''; e.preventDefault(); }
          else if (e.key === 'ArrowLeft' && k > 0) boxes[k - 1].focus();
          else if (e.key === 'ArrowRight' && k < 5) boxes[k + 1].focus();
        };
        b.onpaste = function (e) {
          var text = ((e.clipboardData && e.clipboardData.getData('text')) || '').replace(/[^0-9]/g, '').slice(0, 6);
          if (!text) return;
          e.preventDefault();
          text.split('').forEach(function (d, i) { boxes[i].value = d; });
          boxes[Math.min(text.length, 5)].focus();
        };
        boxes.push(b); wrap.appendChild(b);
      })(k);
    }
    return { node: wrap, first: boxes[0], value: value };
  }
  var CODE_PROMPT = /code reçu par email|code comporte 6 chiffres/i;
  function showAsk(ev) {
    var box = el('div'); box.appendChild(el('p', '', ev.text));
    /* Les suggestions n'apparaissent que sur la vraie question « que puis-je faire pour vous ». */
    if (ev.text === 'Que puis-je faire pour vous ?') {
      var chips = el('div', 'chips');
      ['Mon PC est lent', "Je n'ai pas Internet", 'Mon imprimante ne marche pas', 'Outlook plante', 'Je pense avoir un virus', 'Vérifier tout mon PC'].forEach(function (t) {
        var c = el('button', '', t); c.type = 'button'; c.onclick = function () { reply(ev.id, t); }; chips.appendChild(c);
      });
      box.appendChild(chips);
    }
    var form = el('form'); var focusOn; var read;
    if (CODE_PROMPT.test(ev.text)) {
      var code = codeBoxes(); form.appendChild(code.node); focusOn = code.first; read = code.value;
    } else {
      var input = el('input'); input.type = 'text'; input.maxLength = 1000; input.autocomplete = 'off'; input.setAttribute('aria-label', ev.text);
      form.appendChild(input); focusOn = input; read = function () { return input.value; };
    }
    form.appendChild(sendButton());
    var attach = el('div', 'attach');
    var pick = el('button', ''); pick.type = 'button'; pick.appendChild(icon('clip')); pick.appendChild(el('span', '', "Joindre une capture d'écran"));
    var file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg'; file.style.display = 'none';
    pick.onclick = function () { file.click(); };
    file.onchange = function () { if (file.files && file.files[0]) sendImage(file.files[0], note); };
    var note = el('span', '', "Masquez d'abord les mots de passe et les données personnelles.");
    attach.appendChild(pick); attach.appendChild(file); attach.appendChild(note);
    if (!CODE_PROMPT.test(ev.text)) form.appendChild(attach);
    form.onsubmit = function (e) { e.preventDefault(); var v = read(); if (v.trim()) reply(ev.id, v); };
    box.appendChild(form); controls.replaceChildren(box); focusOn.focus();
  }
  function showConfirm(ev) {
    var box = el('div');
    if (ev.title) box.appendChild(el('h2', '', ev.title));
    box.appendChild(el('p', '', ev.text));
    var row = el('div', 'row');
    var yes = el('button', 'act yes', ev.yes); yes.type = 'button'; yes.onclick = function () { reply(ev.id, true); };
    var no = el('button', 'act no', ev.no); no.type = 'button'; no.onclick = function () { reply(ev.id, false); };
    row.appendChild(yes); row.appendChild(no); box.appendChild(row); controls.replaceChildren(box);
  }
  function showChoose(ev) {
    var box = el('div'); box.appendChild(el('p', '', ev.text));
    var row = el('div', 'row');
    ev.options.forEach(function (label, i) {
      var b = el('button', 'act opt', label); b.type = 'button'; b.onclick = function () { reply(ev.id, i); }; row.appendChild(b);
    });
    box.appendChild(row); controls.replaceChildren(box);
  }
  var current = null, chatEnded = false;
  /* L'anneau de l'étape en cours tourne tant que l'agent travaille ; il s'arrête quand il attend la réponse du client. */
  function syncBusy() { document.body.classList.toggle('working', !current && !chatEnded); }
  syncBusy();
  var es = new EventSource('/events?t=' + encodeURIComponent(token));
  es.onmessage = function (m) {
    var ev = JSON.parse(m.data);
    if (ev.type === 'say') { bubble('agent', ev.text); if (!current) showTyping(); }
    else if (ev.type === 'tech') bubble('tech', ev.text, ev.name);
    else if (ev.type === 'user') bubble('user', ev.text);
    else if (ev.type === 'ask') { hideTyping(); current = ev.id; showAsk(ev); }
    else if (ev.type === 'confirm') { hideTyping(); current = ev.id; showConfirm(ev); }
    else if (ev.type === 'choose') { hideTyping(); current = ev.id; showChoose(ev); }
    else if (ev.type === 'step') setStep(ev.n);
    else if (ev.type === 'tasks') setTasks(ev);
    else if (ev.type === 'results') showResults(ev.view);
    else if (ev.type === 'resolved') { if (current === ev.id) { clearControls(); current = null; showTyping(); } }
    else if (ev.type === 'ended') { chatEnded = true; hideTyping(); bubble('note', ev.text); clearControls(); setStep(4); es.close(); }
    syncBusy();
  };
  document.getElementById('handoff').onclick = function () { post('/handoff'); };
})();
</script>
</body>
</html>`;
