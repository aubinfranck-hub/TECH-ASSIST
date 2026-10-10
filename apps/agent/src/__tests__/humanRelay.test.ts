import { describe, expect, it } from 'vitest';
import type { RelayPoll } from '../appAccount.js';
import { RELAY_INTRO, RELAY_WAITING, relayWithTechnician, type RelayApi } from '../humanRelay.js';
import type { ConversationUi } from '../types.js';

/** Faux écran : enregistre ce qui est affiché ; les réponses du client sont fournies à la demande. */
function fakeUi() {
  const shown: string[] = [];
  const fromTech: string[] = [];
  const answers: ((v: string | null) => void)[] = [];
  const ui: ConversationUi = {
    info: (m) => void shown.push(m),
    confirmAction: async () => true,
    confirmFixed: async () => true,
    ask: () => new Promise<string | null>((resolve) => answers.push(resolve)),
    choose: async () => 0,
    fromTechnician: (name, text) => void fromTech.push(`${name}: ${text}`),
  };
  return { ui, shown, fromTech, reply: (v: string | null) => answers.shift()?.(v), pending: () => answers.length };
}

const poll = (over: Partial<RelayPoll['state']> = {}, messages: RelayPoll['messages'] = []): RelayPoll => ({
  state: { status: 'created', requested: true, claimed: false, technician: null, ...over },
  messages,
});

function fakeApi(script: (after: number, call: number) => RelayPoll | Error) {
  const sent: string[] = [];
  const afters: number[] = [];
  let calls = 0;
  const api: RelayApi = {
    relayPoll: async (_t, _s, after) => {
      afters.push(after);
      const r = script(after, calls++);
      if (r instanceof Error) throw r;
      return r;
    },
    relaySend: async (_t, _s, body) => void sent.push(body),
  };
  return { api, sent, afters };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe('relais avec le technicien (la fenêtre reste ouverte)', () => {
  it("affiche les messages du technicien, envoie les réponses du client, s'arrête quand l'assistance est terminée", async () => {
    const f = fakeUi();
    const a = fakeApi((_after, call) => {
      if (call === 0) return poll();
      if (call === 1) return poll({ claimed: true, status: 'active', technician: 'Awa' }, [
        { id: 1, sender: 'system', body: 'Awa a pris votre demande.', name: null },
        { id: 2, sender: 'technician', body: 'Bonjour, je regarde.', name: 'Awa' },
        { id: 3, sender: 'client', body: 'mon propre message', name: null },
      ]);
      if (call < 4) return poll({ claimed: true, status: 'active', technician: 'Awa' });
      return poll({ claimed: true, status: 'completed', technician: 'Awa' }, [{ id: 4, sender: 'system', body: 'Fini.', name: null }]);
    });
    const done = relayWithTechnician({ ui: f.ui, api: a.api, token: 't', sessionId: 's', pollMs: 10 });
    await tick();
    f.reply('Merci !');
    expect(await done).toBe('finished');
    expect(f.shown[0]).toBe(RELAY_INTRO);
    expect(f.shown).toContain('Awa a pris votre demande.');
    expect(f.fromTech).toEqual(['Awa: Bonjour, je regarde.']);
    expect(f.shown.join('\n')).not.toContain('mon propre message'); // le client ne revoit pas son message en double
    expect(a.sent).toEqual(['Merci !']);
    expect(a.afters.slice(0, 3)).toEqual([0, 0, 3]); // ne redemande que les nouveaux messages
    expect(f.shown.at(-1)).toMatch(/terminée/);
  });

  it("s'arrête quand le client ferme la fenêtre", async () => {
    const f = fakeUi();
    const a = fakeApi(() => poll());
    const done = relayWithTechnician({ ui: f.ui, api: a.api, token: 't', sessionId: 's', pollMs: 5 });
    await tick();
    f.reply(null);
    expect(await done).toBe('closed');
  });

  it("rassure le client une seule fois quand personne ne répond", async () => {
    const f = fakeUi();
    let clock = 0;
    const a = fakeApi(() => poll());
    const done = relayWithTechnician({ ui: f.ui, api: a.api, token: 't', sessionId: 's', pollMs: 5, waitNoticeMs: 1000, now: () => clock });
    await tick();
    expect(f.shown.filter((m) => m === RELAY_WAITING)).toHaveLength(0);
    clock = 5000;
    await tick();
    await tick();
    clock = 9000;
    await tick();
    expect(f.shown.filter((m) => m === RELAY_WAITING)).toHaveLength(1);
    f.reply(null);
    await done;
  });

  it('signale un message non envoyé et continue', async () => {
    const f = fakeUi();
    const a = fakeApi(() => poll());
    a.api.relaySend = async () => {
      throw new Error('hors ligne');
    };
    const done = relayWithTechnician({ ui: f.ui, api: a.api, token: 't', sessionId: 's', pollMs: 5 });
    await tick();
    f.reply('Allô ?');
    await tick();
    await tick();
    expect(f.shown.some((m) => m.includes("n'a pas pu être envoyé") && m.includes('hors ligne'))).toBe(true);
    expect(f.pending()).toBe(1); // la question est reposée
    f.reply(null);
    expect(await done).toBe('closed');
  });

  it('renonce honnêtement après trop d’échecs de connexion', async () => {
    const f = fakeUi();
    const a = fakeApi(() => new Error('réseau'));
    const end = await relayWithTechnician({ ui: f.ui, api: a.api, token: 't', sessionId: 's', pollMs: 1, maxFailures: 3 });
    expect(end).toBe('unreachable');
    expect(f.shown.at(-1)).toMatch(/un technicien vous appellera/);
  });

  it('supporte un écran sans zone technicien : le message est affiché avec son nom', async () => {
    const f = fakeUi();
    delete (f.ui as { fromTechnician?: unknown }).fromTechnician;
    const a = fakeApi((_x, call) => (call === 0 ? poll({ status: 'active', claimed: true }, [{ id: 1, sender: 'technician', body: 'Salut', name: 'Awa' }]) : poll({ status: 'completed' })));
    const done = relayWithTechnician({ ui: f.ui, api: a.api, token: 't', sessionId: 's', pollMs: 5 });
    expect(await done).toBe('finished');
    expect(f.shown).toContain('Awa : Salut');
  });
});
