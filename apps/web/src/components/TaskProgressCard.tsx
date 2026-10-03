import { useEffect, useState } from 'react';
import { clock, formatDuration, summarize, usualRange, type Progress, type ProgressTask } from '../lib/taskProgress.js';

const MARK: Record<ProgressTask['state'], string> = { done: '✓', failed: '✗', skipped: '–', pending: '○', running: '' };

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600 motion-reduce:animate-none ${className}`} />;
}

/**
 * Ce que l'agent fait sur le PC du client, en direct : tâche en cours (avec chronomètre et durée habituelle),
 * progression, reste estimé, et la liste des tâches. `receivedAt` : instant où l'état a été reçu du serveur.
 */
export function TaskProgressCard({ progress, receivedAt, live }: { progress: Progress; receivedAt: number; live: boolean }) {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const ticking = live && progress.items.some((t) => t.state === 'running');
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const extra = Math.max(0, (Date.now() - receivedAt) / 1000);
  const s = summarize(progress, extra, live);
  const quiet = Math.round(progress.ageSeconds + extra);

  const status = s.stale
    ? { label: 'Sans nouvelles', cls: 'bg-amber-50 text-amber-800' }
    : s.running
      ? { label: 'En direct', cls: 'bg-emerald-50 text-emerald-700' }
      : s.allDone && progress.complete
        ? { label: 'Terminé', cls: 'bg-slate-100 text-slate-600' }
        : { label: 'En pause', cls: 'bg-slate-100 text-slate-600' };

  let title: string;
  let meta: string;
  if (s.running) {
    title = s.running.title;
    meta = s.stale
      ? `Plus de nouvelles de l'agent depuis ${formatDuration(quiet)}. L'ordinateur du client est peut-être éteint ou hors connexion. Dernier relevé : ${clock(s.elapsed)}.`
      : s.late
        ? `En cours depuis ${clock(s.elapsed)}, plus long que d'habitude (${usualRange(s.running.min, s.running.max)}). Courant sur certains ordinateurs.`
        : `En cours depuis ${clock(s.elapsed)} · durée habituelle : ${usualRange(s.running.min, s.running.max)}`;
  } else if (s.next) {
    title = `Prochaine tâche : ${s.next.title}`;
    meta = `Durée habituelle : ${usualRange(s.next.min, s.next.max)}`;
  } else {
    const last = progress.items.filter((t) => t.state === 'done' || t.state === 'failed').at(-1);
    const count = `${s.count} tâche${s.count > 1 ? 's' : ''}${s.failed ? ` · ${s.failed} non réussie${s.failed > 1 ? 's' : ''}` : ''}`;
    title = progress.complete ? 'Intervention terminée' : last ? `${last.title} : terminé` : 'Aucune tâche en cours';
    meta = progress.complete ? count : `L'agent attend une réponse du client · ${count}`;
  }
  const left = s.allDone ? `${progress.complete ? 'Durée totale' : 'Durée'} : ${formatDuration(s.spent)}` : `Tâche ${s.position} sur ${s.count}`;
  const right = !s.remaining ? '' : s.stale ? '' : s.remaining.high < 60 ? "Il reste moins d'une minute" : `Reste environ ${usualRange(s.remaining.low, s.remaining.high)}`;

  return (
    <section className="ta-card space-y-3 p-4" aria-label="Avancement de l'intervention">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Avancement de l'intervention</h3>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${status.cls}`}>{status.label}</span>
      </div>

      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          {s.running && !s.stale ? <Spinner className="h-5 w-5" /> : <span aria-hidden="true" className={`text-base font-bold ${s.stale ? 'text-amber-600' : s.allDone ? 'text-emerald-600' : 'text-slate-400'}`}>{s.stale ? '!' : s.allDone ? '✓' : '○'}</span>}
        </span>
        <div className="min-w-0">
          <p className="break-words font-medium">{title}</p>
          <p className={`mt-0.5 text-sm ${s.late || s.stale ? 'text-amber-800' : 'text-slate-500'}`}>{meta}</p>
        </div>
      </div>

      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s.percent} aria-label="Progression estimée" className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full transition-[width] duration-700 ${s.stale ? 'bg-amber-400' : 'bg-brand-600'}`} style={{ width: `${s.percent}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-slate-500">
        <span>{left}</span>
        <span>{right}</span>
      </div>

      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-sm font-semibold text-brand-700">
        {open ? 'Masquer le détail' : 'Voir le détail'}
      </button>
      {open && (
        <ol className="space-y-1.5 text-sm">
          {progress.items.map((t) => {
            const running = t.state === 'running';
            const when = running
              ? `${clock(s.running?.id === t.id ? s.elapsed : (t.elapsed ?? 0))} / ${usualRange(t.min, t.max)}`
              : t.state === 'done' || t.state === 'failed'
                ? formatDuration(t.seconds ?? 0)
                : t.state === 'skipped'
                  ? 'inutile'
                  : `≈ ${usualRange(t.min, t.max)}`;
            return (
              <li key={t.id} className={`flex items-start gap-2 ${t.state === 'failed' ? 'text-red-700' : t.state === 'done' ? 'text-slate-700' : running ? 'font-medium text-slate-900' : 'text-slate-400'}`}>
                <span className="flex h-5 w-4 shrink-0 items-center justify-center">{running ? <Spinner className="h-3.5 w-3.5" /> : MARK[t.state]}</span>
                <span className="min-w-0 flex-1 break-words">{t.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-500">{when}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
