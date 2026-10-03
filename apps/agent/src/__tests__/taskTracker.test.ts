import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { runSkill } from '../agent.js';
import { ChatUi, type TaskView } from '../chatServer.js';
import { repairMyPc, type RepairStep } from '../repairPc.js';
import { DIAGNOSE_TASK, RESCAN_TASK, SCAN_TASK, VERIFY_TASK, actionTaskId, estimateFor, plannedTasks, taskInfoFor, tracked, type TaskInfo, type TaskResult, type TaskTracker } from '../tasks.js';
import type { Action, Diagnosis, Skill } from '../types.js';
import { Recorder, ScriptedConversation, ScriptedRunner, ok } from './fakeScripts.js';

const diag = (p: Partial<Diagnosis>): Diagnosis => ({ summary: 'ok', problems: [], actions: [], advice: [], healthy: true, needsHuman: false, ...p });
const act = (id: string, patch: Partial<Action> = {}): Action => ({ id, title: `Action ${id}`, explanation: '', requiresAdmin: false, verified: true, run: async () => ({ ok: true, message: 'ok' }), ...patch });

/** Faux suivi : garde la suite des annonces faites par l'agent. */
class FakeTracker implements TaskTracker {
  readonly calls: string[] = [];
  plan(items: TaskInfo[]) {
    this.calls.push(`plan ${items.map((i) => i.id).join(',')}`);
  }
  start(item: TaskInfo) {
    this.calls.push(`start ${item.id}`);
  }
  end(id: string, result: TaskResult) {
    this.calls.push(`end ${id} ${result}`);
  }
  settle() {
    this.calls.push('settle');
  }
}

class TrackedUi extends ScriptedConversation {
  readonly tasks = new FakeTracker();
}

describe('durées habituelles', () => {
  it('les réparations longues ont une durée en minutes, les petites actions en secondes', () => {
    expect(estimateFor('dism_restore_health')).toEqual([600, 2400]);
    expect(estimateFor('sfc_scan')[1]).toBeGreaterThanOrEqual(20 * 60);
    expect(estimateFor('flush_dns')[1]).toBeLessThan(60);
    expect(estimateFor('restore_point')[1]).toBeLessThanOrEqual(120);
  });
  it('les actions avec paramètre (close_office_app:Excel) suivent leur famille ; une inconnue reçoit une durée courte par défaut', () => {
    expect(estimateFor('start_service:Spooler')).toEqual(estimateFor('start_service:Autre'));
    const [min, max] = estimateFor('action_inconnue');
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(120);
  });
  it('chaque durée est cohérente (minimum ≤ maximum)', () => {
    for (const id of ['restore_point', 'dism_restore_health', 'sfc_scan', 'repair_volume', 'clean_temp', 'quick_scan', 'repair_office', 'install_app', 'x']) {
      const [a, b] = estimateFor(id);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThanOrEqual(b);
    }
  });
  it("l'identifiant d'une tâche est celui que l'agent utilise pour ne jamais reproposer une action", () => {
    const a = act('x', { title: 'Titre' });
    expect(taskInfoFor(a).id).toBe(actionTaskId(a));
    expect(actionTaskId(a)).toBe('x|Titre');
  });
  it('plannedTasks : point de restauration une seule fois, juste avant la première action qui en a besoin', () => {
    const restore = act('restore_point', { title: 'Point de restauration' });
    const out = plannedTasks([act('a', { prepare: restore }), act('b', { prepare: restore }), act('c')]);
    expect(out.map((t) => t.id)).toEqual(['restore_point|Point de restauration', 'a|Action a', 'b|Action b', 'c|Action c']);
  });
});

describe('tracked', () => {
  it('annonce le début et la fin, et rend le résultat', async () => {
    const ui = { tasks: new FakeTracker() };
    const r = await tracked(ui, SCAN_TASK, async () => 42);
    expect(r).toBe(42);
    expect(ui.tasks.calls).toEqual([`start ${SCAN_TASK.id}`, `end ${SCAN_TASK.id} done`]);
  });
  it("une tâche qui échoue (résultat refusé par `ok`, ou exception) est close « failed »", async () => {
    const ui = { tasks: new FakeTracker() };
    await tracked(ui, RESCAN_TASK, async () => ({ ok: false }), (r) => r.ok);
    await expect(tracked(ui, SCAN_TASK, async () => { throw new Error('boum'); })).rejects.toThrow('boum');
    expect(ui.tasks.calls).toEqual([`start ${RESCAN_TASK.id}`, `end ${RESCAN_TASK.id} failed`, `start ${SCAN_TASK.id}`, `end ${SCAN_TASK.id} failed`]);
  });
  it('sans suivi (terminal), le travail se fait quand même', async () => {
    expect(await tracked({}, SCAN_TASK, async () => 'ok')).toBe('ok');
  });
});

describe("l'agent annonce ses tâches", () => {
  const skill = (): { skill: Skill; state: { fixed: boolean } } => {
    const state = { fixed: false };
    return {
      state,
      skill: {
        id: 'demo',
        title: 'Démo',
        verifyQuestion: 'Réglé ?',
        async diagnose() {
          if (state.fixed) return diag({ summary: 'Corrigé' });
          return diag({
            summary: 'Problème',
            healthy: false,
            actions: [act('fix', { risk: 'sensitive', prepare: act('restore_point', { title: 'Point de restauration' }), run: async () => ((state.fixed = true), { ok: true, message: 'ok' }) })],
          });
        },
      },
    };
  };
  const runner = () => new ScriptedRunner([{ label: 'any', test: () => true, reply: () => ok() }]);

  it('analyse, point de restauration, correction, vérification : chaque étape est une tâche, puis la série est close', async () => {
    const ui = new TrackedUi();
    const { skill: s } = skill();
    await runSkill(s, { runner: runner(), ui, reporter: new Recorder() });
    expect(ui.tasks.calls).toEqual([
      `start ${DIAGNOSE_TASK('Démo').id}`,
      `end ${DIAGNOSE_TASK('Démo').id} done`,
      'start restore_point|Point de restauration',
      'end restore_point|Point de restauration done',
      'start fix|Action fix',
      'end fix|Action fix done',
      `start ${VERIFY_TASK('Démo').id}`,
      `end ${VERIFY_TASK('Démo').id} done`,
      'settle',
    ]);
  });

  it('une action qui échoue est close « failed » et la série est quand même close', async () => {
    const ui = new TrackedUi();
    const s: Skill = {
      id: 'demo',
      title: 'Démo',
      verifyQuestion: '?',
      diagnose: async () => diag({ summary: 'P', healthy: false, actions: [act('fix', { run: async () => ({ ok: false, message: 'Accès refusé' }) })] }),
    };
    await runSkill(s, { runner: runner(), ui, reporter: new Recorder() });
    expect(ui.tasks.calls).toContain('end fix|Action fix failed');
    expect(ui.tasks.calls.at(-1)).toBe('settle');
  });

  it("une action refusée par le client n'est jamais annoncée comme tâche en cours", async () => {
    const ui = new TrackedUi();
    ui.proposed.length = 0;
    const refusing = new TrackedUi({ approve: { fix: false } });
    const { skill: s } = skill();
    await runSkill(s, { runner: runner(), ui: refusing, reporter: new Recorder() });
    expect(refusing.tasks.calls.some((c) => c.startsWith('start fix'))).toBe(false);
    void ui;
  });

  it('« Réparer mon PC » : une analyse complète, le programme annoncé d’avance, puis la vérification finale', async () => {
    const mk = (id: string): RepairStep => {
      const state = { fixed: false };
      const skill: Skill = {
        id,
        title: `Tâche ${id}`,
        verifyQuestion: '?',
        diagnose: async () =>
          state.fixed
            ? diag({ summary: 'Corrigé' })
            : diag({ summary: `Problème ${id}`, healthy: false, actions: [act(`fix_${id}`, { run: async () => ((state.fixed = true), { ok: true, message: 'ok' }) })] }),
      };
      return { id, label: `Étape ${id}`, build: () => skill };
    };
    const ui = new TrackedUi();
    await repairMyPc({ runner: runner(), ui, reporter: new Recorder(), machine: 'PC' }, [mk('a'), mk('b')]);
    const c = ui.tasks.calls;
    expect(c[0]).toBe(`start ${SCAN_TASK.id}`);
    expect(c[1]).toBe(`end ${SCAN_TASK.id} done`);
    expect(c[2]).toBe(`plan fix_a|Action fix_a,fix_b|Action fix_b,${RESCAN_TASK.id}`);
    expect(c.slice(3)).toEqual([
      'start fix_a|Action fix_a',
      'end fix_a|Action fix_a done',
      'start fix_b|Action fix_b',
      'end fix_b|Action fix_b done',
      `start ${RESCAN_TASK.id}`,
      `end ${RESCAN_TASK.id} done`,
      'settle',
    ]);
    // Dans « Réparer mon PC », les analyses isolées de chaque étape ne sont pas annoncées une par une.
    expect(c.some((x) => x.includes('phase:diagnose'))).toBe(false);
  });

  it('« Réparer mon PC » sans rien à corriger : l\'analyse est annoncée puis la série est conclue', async () => {
    const ui = new TrackedUi();
    const healthy: RepairStep = { id: 'a', label: 'A', build: () => ({ id: 'a', title: 'A', verifyQuestion: '?', diagnose: async () => diag({}) }) };
    await repairMyPc({ runner: runner(), ui, reporter: new Recorder() }, [healthy]);
    expect(ui.tasks.calls).toEqual([`start ${SCAN_TASK.id}`, `end ${SCAN_TASK.id} done`, 'settle']);
  });

  it('« Réparer mon PC » refusé par le client : rien n\'est planifié et la série est conclue', async () => {
    const ui = new TrackedUi({ approve: { confirm_only: false } });
    const broken: RepairStep = { id: 'a', label: 'A', build: () => ({ id: 'a', title: 'A', verifyQuestion: '?', diagnose: async () => diag({ summary: 'P', healthy: false, actions: [act('fix')] }) }) };
    await repairMyPc({ runner: runner(), ui, reporter: new Recorder() }, [broken]);
    expect(ui.tasks.calls).toEqual([`start ${SCAN_TASK.id}`, `end ${SCAN_TASK.id} done`, 'settle']);
  });

  it("sans suivi (terminal), l'agent annonce toujours chaque action en une ligne", async () => {
    const ui = new ScriptedConversation();
    const { skill: s } = skill();
    await runSkill(s, { runner: runner(), ui, reporter: new Recorder() });
    expect(ui.said).toMatch(/Action fix/);
  });
});

interface Ev {
  type: string;
  items?: TaskView[];
  complete?: boolean;
  seq: number;
}

describe('ChatUi : fenêtre du client', () => {
  const info = (id: string, min = 10, max = 60): TaskInfo => ({ id, title: `Tâche ${id}`, min, max });

  /** Flux d'événements de la page (comme le fait le navigateur), lu avec le client http de Node : les en-têtes ne partent qu'avec le premier événement. */
  function listen(ui: ChatUi) {
    const url = new URL(ui.url);
    const events: Ev[] = [];
    let buffer = '';
    const req = request({ host: '127.0.0.1', port: Number(url.port), path: `/events?t=${url.searchParams.get('t')}` }, (res) => {
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame.split('\n').find((l) => l.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)) as Ev);
        }
      });
    });
    req.on('error', () => undefined);
    req.end();
    return { events, stop: () => req.destroy() };
  }

  async function open() {
    const ui = await ChatUi.start({ openWaitMs: 600_000, graceMs: 600_000 });
    const feed = listen(ui);
    const latest = () => feed.events.filter((e) => e.type === 'tasks').at(-1);
    const wait = () => new Promise((r) => setTimeout(r, 60));
    return {
      ui,
      events: feed.events,
      latest,
      wait,
      stop: async () => {
        feed.stop();
        await ui.close();
      },
    };
  }

  it('annonce l’état complet à chaque changement : en attente, en cours (avec son heure de début), terminé (avec sa durée)', async () => {
    const w = await open();
    w.ui.tasks.plan([info('a'), info('b')]);
    await w.wait();
    expect(w.latest()!.items!.map((t) => t.state)).toEqual(['pending', 'pending']);

    w.ui.tasks.start(info('a'));
    await w.wait();
    const running = w.latest()!.items![0]!;
    expect(running.state).toBe('running');
    expect(running.startedAt).toBeGreaterThan(0);
    expect(running).toMatchObject({ min: 10, max: 60 });

    w.ui.tasks.end('a', 'done');
    await w.wait();
    const done = w.latest()!.items![0]!;
    expect(done.state).toBe('done');
    expect(done.seconds).toBeGreaterThanOrEqual(0);
    expect(w.latest()!.complete).toBe(false);
    await w.stop();
  });

  it('une tâche non prévue est ajoutée ; une tâche déjà prévue n’est pas dupliquée', async () => {
    const w = await open();
    w.ui.tasks.plan([info('a')]);
    w.ui.tasks.plan([info('a'), info('b')]);
    w.ui.tasks.start(info('z'));
    await w.wait();
    expect(w.latest()!.items!.map((t) => t.id)).toEqual(['a', 'b', 'z']);
    await w.stop();
  });

  it('settle : les tâches restées en attente sont retirées et la série est déclarée terminée', async () => {
    const w = await open();
    w.ui.tasks.plan([info('a'), info('b')]);
    w.ui.tasks.start(info('a'));
    w.ui.tasks.end('a', 'done');
    w.ui.tasks.settle();
    await w.wait();
    expect(w.latest()!.items!.map((t) => t.id)).toEqual(['a']);
    expect(w.latest()!.complete).toBe(true);
    await w.stop();
  });

  it('sans conclusion de l’agent, les tâches terminées restent affichées avec les suivantes', async () => {
    const w = await open();
    w.ui.tasks.start(info('a'));
    w.ui.tasks.end('a', 'done');
    w.ui.tasks.start(info('b'));
    await w.wait();
    expect(w.latest()!.items!.map((t) => `${t.id}:${t.state}`)).toEqual(['a:done', 'b:running']);
    expect(w.latest()!.complete).toBe(false);
    await w.stop();
  });

  it('une nouvelle série repart d’une liste vide quand la précédente est conclue', async () => {
    const w = await open();
    w.ui.tasks.start(info('a'));
    w.ui.tasks.end('a', 'done');
    w.ui.tasks.settle();
    w.ui.tasks.start(info('b'));
    await w.wait();
    expect(w.latest()!.items!.map((t) => t.id)).toEqual(['b']);
    expect(w.latest()!.complete).toBe(false);
    await w.stop();
  });

  it('une page rechargée reçoit seulement le dernier état des tâches', async () => {
    const w = await open();
    w.ui.tasks.start(info('a'));
    w.ui.tasks.end('a', 'done');
    w.ui.tasks.start(info('b'));
    await w.wait();
    const reloaded = listen(w.ui);
    await w.wait();
    const tasks = reloaded.events.filter((e) => e.type === 'tasks');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.items!.map((t) => t.state)).toEqual(['done', 'running']);
    reloaded.stop();
    // Les numéros d'événements restent croissants même après le retrait des anciens états.
    const seqs = w.events.map((e) => e.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    await w.stop();
  });

  it('la page contient le suivi (carte, anneau de l’étape en cours, liste détaillée) et reste sans HTML construit à la volée', async () => {
    const w = await open();
    const url = new URL(w.ui.url);
    const html = await (await fetch(w.ui.url, { headers: { Host: `127.0.0.1:${url.port}` } })).text();
    for (const id of ['id="tasks"', 'id="t-title"', 'id="t-meta"', 'id="t-bar"', 'id="t-list"', 'id="t-toggle"']) expect(html).toContain(id);
    expect(html).toContain('body.working .step.current .dot::before');
    expect(html).toContain("ev.type === 'tasks'");
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    await w.stop();
  });
});
