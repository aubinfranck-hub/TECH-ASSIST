// Essai RÉEL sous Windows (fabrication automatique) de l'application technicien : lance le vrai .exe, qui ouvre une vraie fenêtre Edge/Chrome
// sur une fausse console locale. La fausse page mesure ce que le navigateur autorise vraiment :
//   - adresse ouverte en mode application (?app=1) ;
//   - son autorisé SANS clic (AudioContext « running ») : c'est ce qui permet au ding-dong de sonner fenêtre réduite ;
//   - fenêtre en mode application (pas de barre d'onglets : outerHeight - innerHeight petit).
//   node ci-technicien-window.mjs <chemin du .exe>
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

const exe = process.argv[2];
if (!exe) throw new Error('chemin du .exe manquant');

const PAGE = `<!doctype html><meta charset="utf-8"><title>Console de test</title><body>Console de test<script>
(async () => {
  const ctx = new AudioContext();
  await new Promise((r) => setTimeout(r, 400));
  const info = { audio: ctx.state, search: location.search, h: window.outerHeight - window.innerHeight, ua: navigator.userAgent };
  await fetch('/beacon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(info) });
})();
</script>`;

let beacon;
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/beacon') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      beacon = JSON.parse(body);
      res.writeHead(204).end();
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const child = spawn(exe, ['--no-update', '--test-port', '47355'], {
  env: { ...process.env, TECH_ASSIST_SITE: `http://127.0.0.1:${port}`, TECH_ASSIST_NO_AUTOSTART: '1', TECH_ASSIST_NO_SHORTCUT: '1' },
  stdio: 'ignore',
});

const deadline = Date.now() + 90_000;
while (!beacon && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));

// Arrêt de l'application et de la fenêtre qu'elle a ouverte (arbre de processus).
spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
server.close();

if (!beacon) {
  console.error('ÉCHEC : la fenêtre ne s’est jamais ouverte sur la console de test (90 s).');
  process.exit(1);
}
console.log('Mesures de la vraie fenêtre :', JSON.stringify(beacon));
const problems = [];
if (!beacon.search.includes('app=1')) problems.push(`mode application absent (${beacon.search})`);
if (beacon.audio !== 'running') problems.push(`son bloqué sans clic (AudioContext : ${beacon.audio}) : le ding-dong ne sonnerait pas`);
if (beacon.h > 120) problems.push(`la fenêtre a une barre d'onglets/adresse (écart ${beacon.h} px) : pas en mode application`);
if (problems.length) {
  console.error('ÉCHEC :\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('OK : fenêtre en mode application, son autorisé sans clic.');
