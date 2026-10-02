import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
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

  static async start(options: { port?: number } = {}): Promise<ChatUi> {
    const ui = new ChatUi();
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
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      res.end(PAGE.replaceAll('__NONCE__', nonce));
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

    if (req.method === 'POST' && (url.pathname === '/reply' || url.pathname === '/handoff')) {
      const origin = req.headers.origin;
      if (origin !== undefined && origin !== `http://127.0.0.1:${this.port}` && origin !== `http://localhost:${this.port}`) {
        res.writeHead(403).end();
        return;
      }
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        res.writeHead(415).end();
        return;
      }
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > MAX_BODY) {
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
:root { --brand:#1d4ed8; --bg:#f1f5f9; --card:#fff; --ink:#0f172a; --muted:#64748b; --ok:#15803d; --no:#b91c1c; }
@media (prefers-color-scheme: dark) { :root { --bg:#0b1220; --card:#111a2e; --ink:#e5e7eb; --muted:#94a3b8; } }
* { box-sizing:border-box; }
body { margin:0; font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif; background:var(--bg); color:var(--ink); }
header { position:sticky; top:0; background:var(--brand); color:#fff; padding:12px 16px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
header h1 { margin:0; font-size:1.05rem; }
header button { background:transparent; color:#fff; border:1px solid rgba(255,255,255,.7); border-radius:8px; padding:6px 10px; font:inherit; font-size:.85rem; cursor:pointer; }
main { max-width:680px; margin:0 auto; padding:16px 16px 260px; }
.b { max-width:85%; padding:10px 14px; border-radius:16px; margin:8px 0; white-space:pre-wrap; word-wrap:break-word; }
.agent { background:var(--card); border-bottom-left-radius:4px; }
.user { background:var(--brand); color:#fff; margin-left:auto; border-bottom-right-radius:4px; }
.note { text-align:center; color:var(--muted); font-size:.9rem; }
#controls { position:fixed; left:0; right:0; bottom:0; background:var(--card); border-top:1px solid rgba(100,116,139,.35); padding:12px 16px calc(12px + env(safe-area-inset-bottom)); }
#controls > div { max-width:680px; margin:0 auto; }
#controls h2 { margin:0 0 4px; font-size:1.05rem; }
#controls p { margin:0 0 12px; white-space:pre-wrap; color:var(--muted); }
.row { display:flex; gap:8px; flex-wrap:wrap; }
button.act { flex:1; min-height:44px; border:0; border-radius:10px; font:inherit; font-weight:600; cursor:pointer; background:var(--brand); color:#fff; padding:10px 14px; }
button.yes { background:var(--ok); } button.no { background:var(--no); } button.opt { background:var(--card); color:var(--ink); border:1px solid var(--brand); text-align:left; flex-basis:100%; }
form { display:flex; gap:8px; } input[type=text] { flex:1; min-height:44px; padding:8px 12px; border-radius:10px; border:1px solid var(--muted); font:inherit; background:var(--bg); color:var(--ink); }
</style>
</head>
<body>
<header><h1>Tech Assist — votre assistant</h1><button id="handoff" type="button">Parler à un technicien</button></header>
<main id="log" aria-live="polite"></main>
<section id="controls" aria-label="Votre réponse"></section>
<script nonce="__NONCE__">
(function () {
  var token = new URLSearchParams(location.search).get('t') || '';
  var log = document.getElementById('log');
  var controls = document.getElementById('controls');
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function bubble(cls, text) { log.appendChild(el('div', 'b ' + cls, text)); window.scrollTo(0, document.body.scrollHeight); }
  function post(path, body) {
    return fetch(path + '?t=' + encodeURIComponent(token), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function clearControls() { controls.replaceChildren(); }
  function reply(id, value) { post('/reply', { id: id, value: value }); }
  function showAsk(ev) {
    var box = el('div'); box.appendChild(el('p', '', ev.text));
    var form = el('form'); var input = el('input'); input.type = 'text'; input.maxLength = 1000; input.autocomplete = 'off'; input.setAttribute('aria-label', ev.text);
    var send = el('button', 'act', 'Envoyer'); send.type = 'submit';
    form.appendChild(input); form.appendChild(send);
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
  var es = new EventSource('/events?t=' + encodeURIComponent(token));
  es.onmessage = function (m) {
    var ev = JSON.parse(m.data);
    if (ev.type === 'say') bubble('agent', ev.text);
    else if (ev.type === 'user') bubble('user', ev.text);
    else if (ev.type === 'ask') { current = ev.id; showAsk(ev); }
    else if (ev.type === 'confirm') { current = ev.id; showConfirm(ev); }
    else if (ev.type === 'choose') { current = ev.id; showChoose(ev); }
    else if (ev.type === 'resolved') { if (current === ev.id) { clearControls(); current = null; } }
    else if (ev.type === 'ended') { bubble('note', ev.text); clearControls(); es.close(); }
  };
  document.getElementById('handoff').onclick = function () { post('/handoff'); };
})();
</script>
</body>
</html>`;
