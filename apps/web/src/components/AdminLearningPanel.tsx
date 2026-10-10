import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

interface Procedure {
  id: string;
  title: string;
  status: 'candidate' | 'trusted' | 'retired';
  locked: boolean;
  source: string;
  example_query: string | null;
  uses: number;
  successes: number;
  failures: number;
  procedure: { summary?: string; checks?: unknown[]; fixes?: { tool: string; why: string }[] };
}
interface Gap {
  id: string;
  sample_query: string;
  reason: string | null;
  occurrences: number;
  status: 'open' | 'done' | 'ignored';
}

const TONE = { candidate: 'bg-amber-50 text-amber-800', trusted: 'bg-emerald-50 text-emerald-800', retired: 'bg-slate-100 text-slate-500' };
const LABEL = { candidate: 'À confirmer', trusted: 'De confiance', retired: 'Écartée' };

/** Ce que l'IA a appris : relire, valider ou écarter une procédure ; cas que le catalogue ne sait pas encore traiter. */
export function AdminLearningPanel() {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, g] = await Promise.all([api.get<{ procedures: Procedure[] }>('/api/admin/knowledge'), api.get<{ gaps: Gap[] }>('/api/admin/knowledge/gaps')]);
      setProcedures(p.procedures);
      setGaps(g.gaps);
    } catch {
      setError("Impossible de charger l'apprentissage.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(path: string, body?: unknown) {
    setError(null);
    try {
      await api.post(path, body);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action impossible.');
    }
    void load();
  }

  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Apprentissage de l'IA</h2>
      {error && <p className="text-red-600">{error}</p>}
      {procedures.length === 0 && <p className="text-sm text-slate-500">Rien d'appris pour l'instant.</p>}
      <ul className="space-y-2">
        {procedures.map((p) => (
          <li key={p.id} className="rounded-xl border bg-white p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{p.title}</p>
                <p className="text-xs text-slate-500">
                  {p.source} · servie {p.uses} fois · {p.successes} réglé(s), {p.failures} échec(s)
                  {p.example_query ? ` · « ${p.example_query} »` : ''}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${TONE[p.status]}`}>{LABEL[p.status]}{p.locked ? ' ✓' : ''}</span>
            </div>
            {p.procedure.summary && <p className="mt-1 text-slate-600">{p.procedure.summary}</p>}
            {p.procedure.fixes && p.procedure.fixes.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                {p.procedure.fixes.map((f, i) => (
                  <li key={i}>
                    <span className="font-mono">{f.tool}</span> — {f.why}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              {p.status !== 'trusted' && (
                <button onClick={() => void act(`/api/admin/knowledge/${p.id}/approve`)} className="rounded-lg bg-brand-600 px-3 py-1 font-bold text-white">
                  Valider
                </button>
              )}
              {p.status !== 'retired' && (
                <button onClick={() => void act(`/api/admin/knowledge/${p.id}/retire`)} className="rounded-lg border px-3 py-1">
                  Écarter
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <h3 className="pt-2 text-sm font-semibold">Cas que le catalogue ne sait pas traiter ({gaps.filter((g) => g.status === 'open').length})</h3>
      <ul className="space-y-2">
        {gaps.filter((g) => g.status === 'open').map((g) => (
          <li key={g.id} className="flex items-start justify-between gap-3 rounded-xl border bg-white p-3 text-sm">
            <div className="min-w-0">
              <p>« {g.sample_query} »</p>
              <p className="text-xs text-slate-500">demandé {g.occurrences} fois{g.reason ? ` · ${g.reason}` : ''}</p>
            </div>
            <button onClick={() => void act(`/api/admin/knowledge/gaps/${g.id}/status`, { status: 'done' })} className="shrink-0 rounded-lg border px-3 py-1">
              Traité
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
