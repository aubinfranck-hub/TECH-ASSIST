import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatUi, type TaskView } from '../chatServer.js';
import { ProgressSync } from '../progressSync.js';

interface Call {
  url: string;
  method: string;
  auth: string;
  body: { complete: boolean; items: { id: string; title: string; state: string; min: number; max: number; elapsed?: number; seconds?: number }[] };
}

function recorder(opts: { fail?: boolean; hold?: boolean } = {}) {
  const calls: Call[] = [];
  const releases: (() => void)[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method!, auth: (init.headers as Record<string, string>).Authorization!, body: JSON.parse(init.body as string) });
    if (opts.fail) throw new Error('hors ligne');
    if (opts.hold) await new Promise<void>((r) => releases.push(r));
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, releases, impl };
}

const running: TaskView = { id: 'dism', title: 'Réparer Windows (DISM)', state: 'running', min: 600, max: 2400, startedAt: 1_000_000 };
const done: TaskView = { id: 'scan', title: 'Analyse', state: 'done', min: 60, max: 150, startedAt: 900_000, seconds: 74.4 };
const pending: TaskView = { id: 'sfc', title: 'Vérifier', state: 'pending', min: 600, max: 1800 };

describe('ProgressSync : le technicien suit les tâches en direct', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("envoie l'état complet au serveur, avec le temps écoulé en secondes (pas l'heure du PC)", async () => {
    const r = recorder();
    const sync = new ProgressSync('https://api.example/', 'tok', 'sess-1', r.impl, 30_000, () => 1_192_400);
    sync.update({ items: [done, running, pending], complete: false });
    await sync.flush();
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toMatchObject({ url: 'https://api.example/api/app/sessions/sess-1/progress', method: 'PUT', auth: 'Bearer tok' });
    expect(r.calls[0]!.body).toEqual({
      complete: false,
      items: [
        { id: 'scan', title: 'Analyse', state: 'done', min: 60, max: 150, seconds: 74 },
        { id: 'dism', title: 'Réparer Windows (DISM)', state: 'running', min: 600, max: 2400, elapsed: 192 },
        { id: 'sfc', title: 'Vérifier', state: 'pending', min: 600, max: 1800 },
      ],
    });
    sync.stop();
  });

  it("renvoie l'état toutes les 30 s pendant une tâche, avec un temps écoulé à jour, puis cesse quand plus rien ne tourne", async () => {
    const r = recorder();
    let clock = 1_030_000;
    const sync = new ProgressSync('https://api.example', 'tok', 's', r.impl, 30_000, () => clock);
    sync.update({ items: [running], complete: false });
    await sync.flush();
    expect(r.calls.map((c) => c.body.items[0]!.elapsed)).toEqual([30]);
    clock += 30_000;
    await vi.advanceTimersByTimeAsync(30_000);
    clock += 30_000;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(r.calls.map((c) => c.body.items[0]!.elapsed)).toEqual([30, 60, 90]);

    sync.update({ items: [{ ...running, state: 'done', seconds: 95 }], complete: true });
    await sync.flush();
    const sent = r.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(r.calls).toHaveLength(sent); // plus de battement : tout est terminé
    expect(r.calls.at(-1)!.body.complete).toBe(true);
    sync.stop();
  });

  it("ne fait qu'une requête à la fois : l'état le plus récent part ensuite, sans rien perdre", async () => {
    const r = recorder({ hold: true });
    const sync = new ProgressSync('https://api.example', 'tok', 's', r.impl, 30_000, () => 1_000_000);
    sync.update({ items: [pending], complete: false });
    sync.update({ items: [running], complete: false });
    sync.update({ items: [{ ...running, state: 'done', seconds: 3 }], complete: true });
    expect(r.calls).toHaveLength(1);
    r.releases.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1]!.body.complete).toBe(true);
    r.releases.shift()!();
    await sync.flush();
    expect(r.calls).toHaveLength(2);
  });

  it("n'embête jamais le client : un serveur injoignable est ignoré, et le prochain envoi rattrape", async () => {
    const r = recorder({ fail: true });
    const sync = new ProgressSync('https://api.example', 'tok', 's', r.impl, 30_000, () => 1_000_000);
    expect(() => sync.update({ items: [running], complete: false })).not.toThrow();
    await sync.flush();
    await vi.advanceTimersByTimeAsync(30_000);
    await sync.flush();
    expect(r.calls.length).toBeGreaterThanOrEqual(2);
    sync.stop();
  });

  it("n'envoie plus rien une fois arrêté", async () => {
    const r = recorder();
    const sync = new ProgressSync('https://api.example', 'tok', 's', r.impl, 30_000, () => 1_000_000);
    sync.update({ items: [running], complete: false });
    await sync.flush();
    sync.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    sync.update({ items: [done], complete: true });
    await sync.flush();
    expect(r.calls).toHaveLength(1);
  });
});

describe('ChatUi.onTasks', () => {
  it("signale chaque changement de tâche, et une erreur du suivi serveur ne gêne pas la fenêtre", async () => {
    vi.useRealTimers();
    const ui = await ChatUi.start({ openWaitMs: 60_000 });
    const seen: { states: string[]; complete: boolean }[] = [];
    ui.onTasks = (s) => {
      seen.push({ states: s.items.map((t) => `${t.id}:${t.state}`), complete: s.complete });
      throw new Error('serveur en panne');
    };
    const info = { id: 'a', title: 'Tâche A', min: 5, max: 60 };
    ui.tasks.plan([info]);
    ui.tasks.start(info);
    ui.tasks.end('a', 'done');
    ui.tasks.settle();
    expect(seen).toEqual([
      { states: ['a:pending'], complete: false },
      { states: ['a:running'], complete: false },
      { states: ['a:done'], complete: false },
      { states: ['a:done'], complete: true },
    ]);
    await ui.close();
  });
});
