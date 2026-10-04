import { useState } from 'react';
import { api } from '../lib/api.js';

interface Result {
  id: number;
  category: string;
  title: string;
  cause: string;
  solution: string;
  advanced: boolean;
}

/** Base de pannes du technicien : tape le symptôme, lit la cause et la solution d'atelier. */
export function PannesSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    try {
      setResults((await api.get<{ results: Result[] }>(`/api/technician/pannes?q=${encodeURIComponent(q.trim())}`)).results);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <input className="ta-input flex-1" placeholder="Symptôme : écran noir, Outlook plante…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="ta-button-secondary !w-auto !py-2 disabled:opacity-50" disabled={busy || q.trim().length < 3}>{busy ? '…' : 'Chercher'}</button>
      </form>
      {results && results.length === 0 && <p className="text-sm text-slate-500">Aucune fiche trouvée. Essayez d'autres mots.</p>}
      <ul className="space-y-2">
        {results?.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <p className="text-xs font-semibold text-slate-500">{r.category}{r.advanced && ' · avancé (matériel, BIOS ou registre)'}</p>
            <p className="mt-0.5 font-semibold">{r.title}</p>
            {r.cause && <p className="mt-1 text-slate-600"><span className="font-semibold">Cause :</span> {r.cause}</p>}
            <p className="mt-1 text-slate-800"><span className="font-semibold">Solution :</span> {r.solution}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
