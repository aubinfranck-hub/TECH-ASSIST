// Faux serveur pour l'essai sur émulateur : parle comme l'API (flux SSE des demandes) et comme le site (page « console » minimale).
//   API  : :8099  /api/technician/stream  (jeton attendu : 40 « T »)
//   Site : :8098  /technicien             (la page appelle l'interface native TechAssistApp.setToken puis signale ce qu'elle a vu)
// Chronologie : à l'ouverture du flux → hello + file vide ; +6 s → une demande ; +16 s → « prise par un confrère ».
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';

const TOKEN = 'T'.repeat(40);
const ID = '11111111-1111-1111-1111-111111111111';
const LOG = process.argv[2] ?? 'mock.log';
const log = (line) => appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`;

createServer((req, res) => {
  if (req.url === '/api/technician/stream') {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      log(`stream REFUSE (authorization=${req.headers.authorization ?? 'absent'})`);
      res.writeHead(401).end();
      return;
    }
    log('stream OUVERT avec le bon jeton');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write(': ouvert\n\n');
    res.write(frame('hello', { onDuty: true }));
    res.write(frame('snapshot', { queue: [] }));
    const t1 = setTimeout(() => {
      log('envoi de la demande');
      res.write(frame('request', { request: { id: ID, platform: 'windows', who: 'Awa Koné', reason: 'Micro défectueux, rien ne passe', at: new Date().toISOString() } }));
    }, 6000);
    const t2 = setTimeout(() => {
      log('envoi de « prise par un confrère »');
      res.write(frame('taken', { sessionId: ID, by: 'Kofi' }));
    }, 16000);
    const ping = setInterval(() => res.write(': ping\n\n'), 5000);
    req.on('close', () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(ping);
      log('stream FERME');
    });
    return;
  }
  res.writeHead(404).end();
}).listen(8099, '0.0.0.0');

createServer((req, res) => {
  if (req.url?.startsWith('/beacon')) {
    log(`page : ${req.url}`);
    res.writeHead(204).end();
    return;
  }
  if (req.url?.startsWith('/technicien')) {
    log(`page demandée : ${req.url.replace(/#.*/, '')}`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>Console de test</title><body>Console de test<script>
      const hasBridge = typeof TechAssistApp !== 'undefined';
      let called = false;
      if (hasBridge) { try { TechAssistApp.setToken('${TOKEN}'); called = true; } catch (e) {} }
      new Image().src = '/beacon?bridge=' + hasBridge + '&setToken=' + called + '&ua=' + encodeURIComponent(navigator.userAgent.split(' ').slice(-1)[0]);
    </script>`);
    return;
  }
  res.writeHead(404).end();
}).listen(8098, '0.0.0.0');

log('faux serveur prêt');
