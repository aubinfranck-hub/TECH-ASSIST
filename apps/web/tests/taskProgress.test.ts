import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaskProgressCard } from '../src/components/TaskProgressCard.js';
import { clock, formatDuration, summarize, usualRange, type Progress } from '../src/lib/taskProgress.js';

const base = (over: Partial<Progress> = {}): Progress => ({
  complete: false,
  ageSeconds: 0,
  items: [
    { id: 'scan', title: 'Analyse de votre ordinateur', state: 'done', min: 60, max: 150, seconds: 74 },
    { id: 'rp', title: 'Créer un point de restauration', state: 'done', min: 15, max: 90, seconds: 20 },
    { id: 'dism', title: 'Réparer les fichiers de Windows (DISM)', state: 'running', min: 600, max: 2400, elapsed: 192 },
    { id: 'sfc', title: 'Vérifier les fichiers système', state: 'pending', min: 600, max: 1800 },
  ],
  ...over,
});

describe('formats', () => {
  it('chronomètre et durées lisibles', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(187)).toBe('3:07');
    expect(clock(-5)).toBe('0:00');
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(600)).toBe('10 min');
    expect(formatDuration(3600 + 25 * 60)).toBe('1 h 25');
    expect(formatDuration(7200)).toBe('2 h');
    expect(usualRange(15, 90)).toBe('15 s à 2 min');
    expect(usualRange(10, 30)).toBe('10 à 30 s');
    expect(usualRange(600, 2400)).toBe('10 à 40 min');
    expect(usualRange(120, 120)).toBe('2 min');
  });
});

describe('summarize', () => {
  it("tâche en cours : temps écoulé qui avance, reste estimé, rang", () => {
    const s = summarize(base({ ageSeconds: 8 }), 2);
    expect(s.running?.id).toBe('dism');
    expect(s.elapsed).toBe(202); // 192 s au dernier relevé + 8 s + 2 s depuis
    expect(s.late).toBe(false);
    expect(s.stale).toBe(false);
    expect(s.count).toBe(4);
    expect(s.position).toBe(3);
    // DISM : 600-202 à 2400-202 ; SFC : 600 à 1800
    expect(s.remaining).toEqual({ low: 398 + 600, high: 2198 + 1800 });
    expect(s.percent).toBeGreaterThan(0);
    expect(s.percent).toBeLessThan(97);
  });

  it("plus long que la durée habituelle : le dit, et ne promet plus de fin proche", () => {
    const p = base();
    p.items[2]!.elapsed = 2500;
    const s = summarize(p);
    expect(s.late).toBe(true);
    expect(s.remaining!.high).toBe(1800); // reste seulement la tâche suivante
  });

  it("sans nouvelles de l'agent depuis plus de 2 minutes : chronomètre figé, signalé", () => {
    const s = summarize(base({ ageSeconds: 400 }));
    expect(s.stale).toBe(true);
    expect(s.elapsed).toBe(192);
    // Assistance terminée alors qu'une tâche était en cours : interrompue, pas « en direct ».
    expect(summarize(base(), 0, false).stale).toBe(true);
  });

  it("tout est fait : 100 % seulement si l'agent a conclu, durée réelle cumulée", () => {
    const items = base().items.map((t) => ({ ...t, state: 'done' as const, seconds: 10, elapsed: undefined }));
    const waiting = summarize({ complete: false, ageSeconds: 5, items });
    expect(waiting.allDone).toBe(true);
    expect(waiting.percent).toBeLessThan(100);
    expect(waiting.remaining).toBeNull();
    const finished = summarize({ complete: true, ageSeconds: 5, items });
    expect(finished.percent).toBe(100);
    expect(finished.spent).toBe(40);
  });

  it("les tâches « inutiles » ne comptent pas, les échecs sont comptés", () => {
    const s = summarize({
      complete: true,
      ageSeconds: 0,
      items: [
        { id: 'a', title: 'A', state: 'failed', min: 5, max: 60, seconds: 3 },
        { id: 'b', title: 'B', state: 'skipped', min: 5, max: 60 },
        { id: 'c', title: 'C', state: 'done', min: 5, max: 60, seconds: 4 },
      ],
    });
    expect(s.count).toBe(2);
    expect(s.failed).toBe(1);
  });
});

describe('TaskProgressCard', () => {
  const html = (p: Progress, live = true) => renderToStaticMarkup(createElement(TaskProgressCard, { progress: p, receivedAt: Date.now(), live }));

  it('montre la tâche en cours avec son chronomètre, la durée habituelle et le reste estimé', () => {
    const out = html(base());
    expect(out).toContain('Réparer les fichiers de Windows (DISM)');
    expect(out).toContain('En cours depuis 3:1'); // 192 s ≈ 3:12
    expect(out).toContain('durée habituelle : 10 à 40 min');
    expect(out).toContain('Tâche 3 sur 4');
    expect(out).toContain('Reste environ');
    expect(out).toContain('En direct');
    expect(out).toContain('animate-spin');
    expect(out).toContain('role="progressbar"');
  });

  it("signale l'absence de nouvelles et n'affiche plus de rotation", () => {
    const out = html(base({ ageSeconds: 600 }));
    expect(out).toContain('Sans nouvelles');
    expect(out).toMatch(/peut-être éteint ou hors connexion/);
    expect(out).not.toContain('animate-spin');
  });

  it('intervention terminée', () => {
    const items = base().items.map((t) => ({ ...t, state: 'done' as const, seconds: 30 }));
    const out = html({ complete: true, ageSeconds: 0, items });
    expect(out).toContain('Intervention terminée');
    expect(out).toContain('Durée totale : 2 min');
    expect(out).toContain('Terminé');
  });

  it("l'agent attend le client : pas de rotation, message clair", () => {
    const items = base().items.slice(0, 2);
    const out = html({ complete: false, ageSeconds: 3, items });
    expect(out).toMatch(/attend une réponse du client/);
    expect(out).not.toContain('animate-spin');
  });
});
