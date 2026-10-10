import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatUi } from '../chatServer.js';

const open: ChatUi[] = [];
async function start(options: Parameters<typeof ChatUi.start>[0] = {}) {
  const ui = await ChatUi.start(options);
  open.push(ui);
  return ui;
}
afterEach(async () => {
  await Promise.all(open.splice(0).map((ui) => ui.close()));
});

const parts = (ui: ChatUi) => {
  const url = new URL(ui.url);
  return { port: Number(url.port), token: url.searchParams.get('t')! };
};

function stream(ui: ChatUi) {
  const { port, token } = parts(ui);
  const events: { type: string; n?: number }[] = [];
  let buffer = '';
  const req = request({ host: '127.0.0.1', port, path: `/events?t=${token}` }, (res) => {
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frame.split('\n').find((l) => l.startsWith('data: '));
        if (data) events.push(JSON.parse(data.slice(6)));
      }
    });
  });
  req.on('error', () => undefined);
  req.end();
  return { events, stop: () => req.destroy() };
}

const until = async (test: () => boolean, label: string) => {
  const deadline = Date.now() + 3000;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`délai dépassé : ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('ChatUi — étapes affichées en haut de la fenêtre', () => {
  it("envoie l'étape courante et la rejoue à une page qui se reconnecte", async () => {
    const ui = await start();
    ui.progress(2);
    ui.progress(3);
    const s = stream(ui);
    await until(() => s.events.filter((e) => e.type === 'step').length === 2, 'deux étapes rejouées');
    expect(s.events.filter((e) => e.type === 'step').map((e) => e.n)).toEqual([2, 3]);
    s.stop();
  });
});

describe('ChatUi — fenêtre fermée', () => {
  it("clôt les questions en attente puis n'en pose plus quand la fenêtre est fermée", async () => {
    const ui = await start({ graceMs: 40, openWaitMs: 5_000 });
    let closedCalls = 0;
    ui.onWindowClosed = () => closedCalls++;
    const s = stream(ui);
    await new Promise((r) => setTimeout(r, 30));
    const answer = ui.ask('Quelle est votre adresse email ?');
    await until(() => s.events.some((e) => e.type === 'ask'), 'question affichée');
    s.stop();
    await expect(answer).resolves.toBeNull();
    expect(closedCalls).toBe(1);
    await expect(ui.ask('Autre chose ?')).resolves.toBeNull();
    await expect(ui.confirmFixed('Continuer ?')).resolves.toBe(false);
    await expect(ui.choose('Choix', ['a', 'b'])).resolves.toBeNull();
  });

  it('attend un peu : un rechargement de la page ne ferme rien', async () => {
    const ui = await start({ graceMs: 150, openWaitMs: 5_000 });
    const first = stream(ui);
    await new Promise((r) => setTimeout(r, 30));
    first.stop();
    await new Promise((r) => setTimeout(r, 40));
    const second = stream(ui); // la page se reconnecte avant la fin du délai
    await new Promise((r) => setTimeout(r, 250));
    const answer = ui.ask('Question');
    await until(() => second.events.some((e) => e.type === 'ask'), 'question toujours posée');
    second.stop();
    await expect(answer).resolves.toBeNull();
  });

  it("s'arrête de lui-même si aucune fenêtre ne s'ouvre jamais", async () => {
    const ui = await start({ openWaitMs: 40 });
    let closed = false;
    ui.onWindowClosed = () => (closed = true);
    await until(() => closed, 'abandon sans fenêtre');
    await expect(ui.ask('Question')).resolves.toBeNull();
  });
});
