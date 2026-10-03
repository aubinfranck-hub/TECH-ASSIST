import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Le service worker des notifications, exécuté dans un faux navigateur : affichage de l'alerte et ouverture de la bonne page. */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'), 'utf8');

type Handler = (event: Record<string, unknown>) => void;

function load(windows: { url: string; focus: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }[] = []) {
  const handlers = new Map<string, Handler>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: 'https://tech-assist.example' },
    skipWaiting: () => undefined,
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow: (u: string) => {
        opened.push(u);
        return Promise.resolve(null);
      },
    },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    addEventListener: (type: string, h: Handler) => handlers.set(type, h),
  };
  vm.runInNewContext(source, { self, URL });
  const run = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  return { run, shown, opened };
}

const push = (data: unknown) => ({ data: { json: () => data, text: () => String(data) } });
const click = (url: unknown) => ({ notification: { close: () => undefined, data: { url } } });

describe('service worker des notifications', () => {
  it("affiche l'alerte reçue, qui reste à l'écran jusqu'à ce que le technicien la touche", async () => {
    const sw = load();
    await sw.run('push', push({ title: 'Un client demande un technicien', body: 'Awa · Windows', url: 'https://tech-assist.example/technicien?session=abc' }));
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]!.title).toBe('Un client demande un technicien');
    expect(sw.shown[0]!.options).toMatchObject({ body: 'Awa · Windows', requireInteraction: true, tag: 'https://tech-assist.example/technicien?session=abc' });
  });

  it('affiche quand même une notification si le contenu est illisible', async () => {
    const sw = load();
    await sw.run('push', { data: { json: () => { throw new Error('pas du JSON'); }, text: () => 'texte brut' } });
    expect(sw.shown[0]!.title).toBe('Tech Assist');
    expect(sw.shown[0]!.options.body).toBe('texte brut');
  });

  it("ouvre la demande dans une nouvelle fenêtre quand la console n'est pas ouverte", async () => {
    const sw = load([]);
    await sw.run('notificationclick', click('https://tech-assist.example/technicien?session=abc'));
    expect(sw.opened).toEqual(['/technicien?session=abc']);
  });

  it('réutilise la fenêtre déjà ouverte et la place sur la demande', async () => {
    const calls: string[] = [];
    const win = {
      url: 'https://tech-assist.example/technicien',
      focus: () => Promise.resolve(calls.push('focus')),
      navigate: (u: string) => {
        calls.push(`navigate ${u}`);
        return Promise.resolve(win);
      },
    };
    const sw = load([win]);
    await sw.run('notificationclick', click('https://tech-assist.example/technicien?session=abc'));
    expect(calls).toEqual(['navigate /technicien?session=abc', 'focus']);
    expect(sw.opened).toEqual([]);
  });

  it("n'ouvre jamais une adresse d'un autre site", async () => {
    const sw = load([]);
    await sw.run('notificationclick', click('https://pirate.example/phishing'));
    expect(sw.opened).toEqual(['/technicien']);
    await sw.run('notificationclick', click(42));
    expect(sw.opened).toEqual(['/technicien', '/technicien']);
  });
});
