import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatUi } from '../chatServer.js';

const open: ChatUi[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((ui) => ui.close()));
});

function listen(ui: ChatUi) {
  const url = new URL(ui.url);
  const events: { type: string; code?: string; text?: string }[] = [];
  let buffer = '';
  const req = request({ host: '127.0.0.1', port: Number(url.port), path: `/events?t=${url.searchParams.get('t')}` }, (res) => {
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const data = buffer.slice(0, i).split('\n').find((l) => l.startsWith('data: '));
        buffer = buffer.slice(i + 2);
        if (data) events.push(JSON.parse(data.slice(6)));
      }
    });
  });
  req.end();
  return { events, stop: () => req.destroy() };
}
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('Fenêtre de l’exe : numéro d’aide et arrivée du technicien', () => {
  it('affiche le numéro d’aide (9 chiffres seulement) et le garde pour une page qui se connecte plus tard', async () => {
    const ui = await ChatUi.start();
    open.push(ui);
    ui.showHelpCode('abc');
    ui.showHelpCode('123456789');
    const a = listen(ui);
    await until(() => a.events.some((e) => e.type === 'code'));
    expect(a.events.filter((e) => e.type === 'code')).toEqual([expect.objectContaining({ code: '123456789' })]);
    a.stop();
  });

  it('le technicien arrive : message au client et la conversation avec l’agent se termine', async () => {
    const ui = await ChatUi.start();
    open.push(ui);
    const pending = ui.ask('Que puis-je faire pour vous ?');
    const feed = listen(ui);
    await until(() => feed.events.some((e) => e.type === 'ask'));
    ui.technicianArrived('Awa');
    expect(await pending).toBeNull();
    expect(ui.wasHandedOff()).toBe(true);
    await until(() => feed.events.some((e) => e.type === 'say' && /Awa/.test(e.text ?? '')));
    expect(feed.events.some((e) => e.type === 'say' && /a pris votre demande/.test(e.text ?? ''))).toBe(true);
    // Idempotent : un second appel ne répète rien.
    const n = feed.events.length;
    ui.technicianArrived('Awa');
    await new Promise((r) => setTimeout(r, 80));
    expect(feed.events.length).toBe(n);
    feed.stop();
  });
});
