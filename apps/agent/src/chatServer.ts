import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { MAX_ATTACHMENT_CHARS, type Attachment } from './assistant.js';
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
  | { seq: number; type: 'user'; text: string }
  | { seq: number; type: 'ask'; id: string; text: string }
  | { seq: number; type: 'confirm'; id: string; title: string; text: string; yes: string; no: string }
  | { seq: number; type: 'choose'; id: string; text: string; options: string[] }
  | { seq: number; type: 'resolved'; id: string }
  | { seq: number; type: 'ended'; text: string };

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

  private readonly log: ChatEvent[] = [];
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
  private readonly imageCache = new Map<string, { at: number; type: string; body: Buffer }>();

  static async start(options: { port?: number; site?: string; fetchImpl?: typeof fetch } = {}): Promise<ChatUi> {
    const ui = new ChatUi();
    if (options.site) ui.site = options.site.replace(/\/$/, '');
    if (options.fetchImpl) ui.fetchImpl = options.fetchImpl;
    ui.server = createServer((req, res) => ui.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      ui.server.once('error', reject);
      ui.server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
    });
    ui.port = (ui.server.address() as AddressInfo).port;
    ui.url = `http://127.0.0.1:${ui.port}/?t=${ui.token}`;
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
    return this.prompt<string | null>({ type: 'ask', text: prompt }, { kind: 'ask' }, null);
  }

  choose(question: string, options: string[]): Promise<number | null> {
    return this.prompt<number | null>({ type: 'choose', text: question, options }, { kind: 'choose', options }, null);
  }

  wasHandedOff(): boolean {
    return this.handoff;
  }

  /** La dernière capture jointe, une seule fois : elle n'est ni conservée ni renvoyée ensuite. */
  takeAttachment(): Attachment | null {
    const a = this.attachment;
    this.attachment = null;
    return a;
  }

  /** Le client demande un technicien : toutes les questions en attente sont closes, la conversation s'arrête. */
  requestHandoff(): void {
    if (this.handoff || this.closed) return;
    this.handoff = true;
    this.push({ type: 'say', text: 'Un technicien a été demandé. Il verra cette conversation et vous répondra.' });
    this.settleAll();
    this.onHandoff?.();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
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

  private push(event: NewEvent): ChatEvent {
    const full = { ...event, seq: this.log.length + 1 } as ChatEvent;
    this.log.push(full);
    for (const stream of this.streams) this.write(stream, full);
    return full;
  }

  private write(res: ServerResponse, event: ChatEvent) {
    res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private prompt<T>(event: PromptEvent, pending: Omit<Pending, 'resolve'>, fallback: T): Promise<T> {
    if (this.closed || this.handoff) return Promise.resolve(fallback);
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
      req.on('close', () => this.streams.delete(res));
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

const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tech Assist — assistant</title>
<style nonce="__NONCE__">
:root { --brand:#dc2626; --brand-dark:#b91c1c; --bg:#f6f7f9; --card:#ffffff; --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --ok:#15803d; --no:#b91c1c; --shadow:0 1px 2px rgba(16,24,40,.06),0 4px 16px rgba(16,24,40,.06); }
@media (prefers-color-scheme: dark) { :root { --bg:#0e1116; --card:#171b22; --ink:#e8eaed; --muted:#9aa3af; --line:#262c36; --shadow:0 1px 2px rgba(0,0,0,.4),0 4px 16px rgba(0,0,0,.3); } }
* { box-sizing:border-box; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; font:16px/1.6 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
.brand-mark { width:36px; height:36px; flex:none; }
header { position:sticky; top:0; z-index:5; background:var(--card); border-bottom:1px solid var(--line); box-shadow:var(--shadow); }
header > div { max-width:760px; margin:0 auto; padding:10px 16px; display:flex; align-items:center; gap:12px; }
.trust { max-width:760px; margin:0 auto; padding:0 16px 9px; display:flex; gap:2px 14px; flex-wrap:wrap; font-size:.78rem; color:var(--muted); }
.trust span::before { content:'✓ '; color:var(--ok); font-weight:700; }
.chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 12px; }
.chips button { background:var(--bg); color:var(--ink); border:1px solid var(--line); border-radius:999px; padding:8px 14px; font:inherit; font-size:.9rem; cursor:pointer; }
.chips button:hover { border-color:var(--brand); color:var(--brand); }
.typing { display:flex; gap:10px; margin:14px 0; align-items:center; color:var(--muted); font-size:.88rem; }
.typing i { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--muted); margin-right:4px; animation:blink 1.2s infinite ease-in-out; }
.typing i:nth-child(2) { animation-delay:.2s; } .typing i:nth-child(3) { animation-delay:.4s; }
@keyframes blink { 0%,80%,100% { opacity:.25; } 40% { opacity:1; } }
@media (prefers-reduced-motion: reduce) { .typing i { animation:none; opacity:.6; } }
.work { margin:14px 0; background:var(--card); border:1px solid var(--line); border-radius:18px; overflow:hidden; box-shadow:var(--shadow); animation:rise .3s ease-out; }
.work .status-line { display:flex; align-items:center; gap:8px; padding:10px 14px; font-size:.85rem; color:var(--muted); border-bottom:1px solid var(--line); }
.work .status-line i { display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--brand); animation:blink 1.2s infinite ease-in-out; }
.work .stage { position:relative; overflow:hidden; }
.work .hero { width:100%; height:190px; object-fit:cover; object-position:100% 40%; display:block; background:var(--line); transform:scale(1.22); transform-origin:100% 40%; }
.work .stage .hero { margin-bottom:0; }
.work .body { position:relative; background:var(--card); }
.work .body { padding:14px 16px 6px; }
.work h3 { margin:0 0 4px; font-size:1.08rem; letter-spacing:-.01em; }
.work .body p { margin:0; color:var(--muted); font-size:.93rem; }
.work .grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:12px 16px 0; }
.work .grid figure { margin:0; border-radius:12px; overflow:hidden; border:1px solid var(--line); background:var(--bg); }
.work .grid img { width:100%; height:64px; object-fit:cover; display:block; }
.work .grid figcaption { padding:5px 8px; font-size:.78rem; font-weight:600; }
.work .dots { display:flex; justify-content:center; gap:7px; padding:10px 0 12px; }
.work .dots button { width:8px; height:8px; padding:0; border:0; border-radius:50%; background:var(--line); cursor:pointer; }
.work .dots button[aria-current=true] { background:var(--brand); width:20px; border-radius:99px; }
.work .dots button:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
@media (prefers-reduced-motion: reduce) { .work { animation:none; } .work .status-line i { animation:none; } }
.title { flex:1; min-width:0; }
.title h1 { margin:0; font-size:1rem; font-weight:700; letter-spacing:-.01em; }
.status { display:flex; align-items:center; gap:6px; font-size:.78rem; color:var(--muted); }
.status i { width:8px; height:8px; border-radius:50%; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.2); }
#handoff { background:transparent; color:var(--ink); border:1px solid var(--line); border-radius:999px; padding:7px 14px; font:inherit; font-size:.82rem; font-weight:600; cursor:pointer; white-space:nowrap; transition:border-color .15s,color .15s; }
#handoff:hover { border-color:var(--brand); color:var(--brand); }
main { max-width:760px; margin:0 auto; padding:20px 16px 300px; }
.msg { display:flex; gap:10px; margin:14px 0; align-items:flex-end; animation:rise .22s ease-out; }
.msg.from-user { justify-content:flex-end; }
.avatar { width:30px; height:30px; flex:none; }
.b { max-width:min(82%,560px); padding:11px 15px; border-radius:18px; white-space:pre-wrap; word-wrap:break-word; overflow-wrap:anywhere; box-shadow:var(--shadow); }
.agent { background:var(--card); border:1px solid var(--line); border-bottom-left-radius:6px; }
.user { background:var(--brand); color:#fff; border-bottom-right-radius:6px; }
.note { text-align:center; color:var(--muted); font-size:.85rem; margin:18px 0; }
@keyframes rise { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .msg { animation:none; } }
#controls { position:fixed; left:0; right:0; bottom:0; background:linear-gradient(to top,var(--bg) 70%,transparent); padding:24px 16px calc(16px + env(safe-area-inset-bottom)); }
#controls:empty { display:none; }
#controls > div { max-width:760px; margin:0 auto; background:var(--card); border:1px solid var(--line); border-radius:18px; padding:16px; box-shadow:var(--shadow); }
#controls h2 { margin:0 0 4px; font-size:1.02rem; letter-spacing:-.01em; }
#controls p { margin:0 0 12px; white-space:pre-wrap; color:var(--ink); font-weight:600; }
#controls h2 + p { color:var(--muted); font-weight:400; }
.row { display:flex; gap:10px; flex-wrap:wrap; }
button.act { flex:1; min-height:46px; border:0; border-radius:12px; font:inherit; font-weight:600; cursor:pointer; background:var(--brand); color:#fff; padding:10px 16px; transition:filter .15s,transform .05s; }
button.act:hover { filter:brightness(.94); } button.act:active { transform:translateY(1px); }
button.act:focus-visible, #handoff:focus-visible, input:focus-visible, .attach button:focus-visible { outline:2px solid var(--brand); outline-offset:2px; }
button.yes { background:var(--ok); } button.no { background:transparent; color:var(--no); border:1px solid var(--no); }
button.opt { background:var(--card); color:var(--ink); border:1px solid var(--line); text-align:left; flex-basis:100%; font-weight:500; }
button.opt:hover { border-color:var(--brand); filter:none; }
form { display:flex; gap:10px; flex-wrap:wrap; }
input[type=text] { flex:1; min-width:0; min-height:46px; padding:8px 14px; border-radius:12px; border:1px solid var(--line); font:inherit; background:var(--bg); color:var(--ink); }
input[type=text]:focus { border-color:var(--brand); }
.attach { flex-basis:100%; font-size:.82rem; color:var(--muted); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.attach button { background:transparent; border:1px solid var(--line); color:var(--ink); border-radius:999px; padding:5px 12px; font:inherit; font-size:.82rem; cursor:pointer; }
.attach button:hover { border-color:var(--brand); }
.welcome { text-align:center; padding:28px 8px 8px; }
.welcome .brand-mark { width:64px; height:64px; margin-bottom:10px; }
.welcome h2 { margin:0 0 4px; font-size:1.35rem; letter-spacing:-.02em; }
.welcome p { margin:0; color:var(--muted); }
</style>
</head>
<body>
<header><div>
<svg class="brand-mark" viewBox="0 0 120 120" aria-hidden="true"><rect x="4" y="4" width="112" height="112" rx="28" fill="#dc2626"/><text x="60" y="79" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="58" font-weight="900" letter-spacing="-5">TA</text></svg>
<div class="title"><h1>Tech Assist</h1><div class="status"><i></i>Votre technicien informatique IA</div></div>
<button id="handoff" type="button">Parler à un technicien</button>
</div>
<div class="trust"><span>Reste sur votre PC</span><span>Tout est noté</span><span>Vos fichiers protégés</span><span>Arrêt à tout moment</span></div>
</header>
<main id="log" aria-live="polite">
<div class="welcome" id="welcome">
<svg class="brand-mark" viewBox="0 0 120 120" aria-hidden="true"><rect x="4" y="4" width="112" height="112" rx="28" fill="#dc2626"/><text x="60" y="79" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="58" font-weight="900" letter-spacing="-5">TA</text></svg>
<h2>Bonjour, je suis AI PC</h2><p>Dites-moi simplement ce qui ne va pas. Je m'occupe du reste : je cherche la cause, je corrige, puis je vérifie.</p>
</div>
</main>
<section id="controls" aria-label="Votre réponse"></section>
<script nonce="__NONCE__">
(function () {
  var token = new URLSearchParams(location.search).get('t') || '';
  var log = document.getElementById('log');
  var controls = document.getElementById('controls');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  /* Logo : copie du logo de l'en-tête (jamais de HTML construit à partir de texte). */
  function avatar() {
    var svg = document.querySelector('header svg').cloneNode(true);
    svg.setAttribute('class', 'avatar');
    return svg;
  }
  function bubble(cls, text) {
    var welcome = document.getElementById('welcome'); if (welcome) welcome.remove();
    hideTyping();
    if (cls === 'note') { log.appendChild(el('div', 'note', text)); }
    else {
      var row = el('div', 'msg from-' + cls);
      if (cls === 'agent') row.appendChild(avatar());
      row.appendChild(el('div', 'b ' + cls, text)); log.appendChild(row);
    }
    window.scrollTo(0, document.body.scrollHeight);
  }
  function post(path, body) {
    return fetch(path + '?t=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function clearControls() { controls.replaceChildren(); }
  /* Pendant que l'agent travaille : « Je travaille dessus… » puis, après un instant, des diapositives sur Tech Assist. */
  var typingEl = null, typingTimer = null, slideTimer = null, slidesData = null;
  fetch('/slides?t=' + encodeURIComponent(token)).then(function (r) { return r.json(); }).then(function (d) { slidesData = d.slides || []; }).catch(function () { slidesData = []; });
  function img(cls, path) {
    var i = el('img', cls); i.alt = ''; i.loading = 'lazy'; i.decoding = 'async';
    i.src = '/slide-image?p=' + encodeURIComponent(path) + '&t=' + encodeURIComponent(token);
    i.onerror = function () { i.style.display = 'none'; };
    return i;
  }
  function buildWork() {
    var card = el('div', 'work');
    var status = el('div', 'status-line'); status.appendChild(el('i')); status.appendChild(el('span', '', 'Je travaille sur votre ordinateur…')); card.appendChild(status);
    var stage = el('div', 'stage'); card.appendChild(stage);
    var dots = el('div', 'dots'); card.appendChild(dots);
    var slides = slidesData && slidesData.length ? slidesData : [];
    if (!slides.length) return card;
    var index = 0;
    function show(i) {
      index = (i + slides.length) % slides.length;
      var sl = slides[index];
      stage.replaceChildren();
      if (sl.image) stage.appendChild(img('hero', sl.image));
      var body = el('div', 'body'); body.appendChild(el('h3', '', sl.title)); if (sl.text) body.appendChild(el('p', '', sl.text)); stage.appendChild(body);
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
      typingEl = buildWork(); log.appendChild(typingEl); window.scrollTo(0, document.body.scrollHeight);
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
  function showAsk(ev) {
    var box = el('div'); box.appendChild(el('p', '', ev.text));
    if (!askedOnce) {
      askedOnce = true;
      var chips = el('div', 'chips');
      ['Mon PC est lent', "Je n'ai pas Internet", 'Mon imprimante ne marche pas', 'Outlook plante', 'Je pense avoir un virus', 'Vérifier tout mon PC'].forEach(function (t) {
        var c = el('button', '', t); c.type = 'button'; c.onclick = function () { reply(ev.id, t); }; chips.appendChild(c);
      });
      box.appendChild(chips);
    }
    var form = el('form'); var input = el('input'); input.type = 'text'; input.maxLength = 1000; input.autocomplete = 'off'; input.setAttribute('aria-label', ev.text);
    var send = el('button', 'act', 'Envoyer'); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
    var attach = el('div', 'attach');
    var pick = el('button', '', "📎 Joindre une capture d'écran"); pick.type = 'button';
    var file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg'; file.style.display = 'none';
    pick.onclick = function () { file.click(); };
    file.onchange = function () { if (file.files && file.files[0]) sendImage(file.files[0], note); };
    var note = el('span', '', "Masquez d'abord les mots de passe et les données personnelles.");
    attach.appendChild(pick); attach.appendChild(file); attach.appendChild(note); form.appendChild(attach);
    form.onsubmit = function (e) { e.preventDefault(); if (input.value.trim()) reply(ev.id, input.value); };
    box.appendChild(form); controls.replaceChildren(box); input.focus();
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
  var current = null;
  var askedOnce = false;
  var es = new EventSource('/events?t=' + encodeURIComponent(token));
  es.onmessage = function (m) {
    var ev = JSON.parse(m.data);
    if (ev.type === 'say') { bubble('agent', ev.text); showTyping(); }
    else if (ev.type === 'user') bubble('user', ev.text);
    else if (ev.type === 'ask') { hideTyping(); current = ev.id; showAsk(ev); }
    else if (ev.type === 'confirm') { hideTyping(); current = ev.id; showConfirm(ev); }
    else if (ev.type === 'choose') { hideTyping(); current = ev.id; showChoose(ev); }
    else if (ev.type === 'resolved') { if (current === ev.id) { clearControls(); current = null; showTyping(); } }
    else if (ev.type === 'ended') { hideTyping(); bubble('note', ev.text); clearControls(); es.close(); }
  };
  document.getElementById('handoff').onclick = function () { post('/handoff'); };
})();
</script>
</body>
</html>`;
