import { useState } from 'react';
import { api } from '../lib/api.js';

interface Result {
  id: number | string;
  category: string;
  title: string;
  cause: string;
  solution: string;
  advanced: boolean;
  /** « ia » : fiche rédigée par l'IA lors d'une recherche précédente ou de celle-ci. */
  origin: 'base' | 'ia' | 'client' | 'procedure';
  status: 'trusted' | 'candidate';
}

interface Ai {
  status: 'none' | 'generated' | 'not_configured' | 'limit' | 'unknown' | 'unavailable';
  reason?: string;
}

/** Base de pannes du technicien : tape le symptôme, lit la cause et la solution d'atelier. Sans résultat, l'IA rédige une fiche, mémorisée pour la suite. */
export function PannesSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [ai, setAi] = useState<Ai>({ status: 'none' });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await api.get<{ results: Result[]; ai?: Ai }>(`/api/technician/pannes?q=${encodeURIComponent(q.trim())}`);
      setResults(res.results);
      setAi(res.ai ?? { status: 'none' });
    } catch {
      setResults([]);
      setAi({ status: 'none' });
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function review(id: number | string, verdict: 'trusted' | 'retired') {
    try {
      await api.post(`/api/technician/pannes/${id}/review`, { verdict });
      setResults((list) => (list ?? []).filter((r) => r.id !== id || verdict === 'trusted').map((r) => (r.id === id ? { ...r, status: 'trusted' } : r)));
    } catch {
      // La fiche reste affichée : le technicien peut réessayer.
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <input className="ta-input flex-1" placeholder="Symptôme : écran noir, Outlook plante…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="ta-button-secondary !w-auto !py-2 disabled:opacity-50" disabled={busy || q.trim().length < 3}>{busy ? 'Recherche…' : 'Chercher'}</button>
      </form>
      {busy && <p className="text-xs text-slate-500">Si le lexique ne connaît pas ce cas, l'IA en rédige une fiche (quelques secondes)…</p>}
      {failed && <p className="text-sm text-red-600">Recherche impossible pour le moment. Réessayez.</p>}
      {!failed && results && results.length === 0 && (
        <p className="text-sm text-slate-500">
          {ai.status === 'none' ? "Aucune fiche trouvée. Essayez d'autres mots." : ai.reason ?? "Aucune fiche trouvée. Essayez d'autres mots."}
        </p>
      )}
      <ul className="space-y-2">
        {results?.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <p className="text-xs font-semibold text-slate-500">
              {r.category}
              {r.advanced && ' · avancé (matériel, BIOS ou registre)'}
              {r.origin === 'ia' && (r.status === 'trusted' ? ' · fiche apprise, confirmée' : ' · proposée par l\'IA, à vérifier')}
              {r.origin === 'client' && (r.status === 'trusted' ? ' · retour client, confirmé' : ' · retour d\'un client (« résolu »), à vérifier')}
              {r.origin === 'procedure' && (r.status === 'trusted' ? ' · procédure apprise, confirmée' : ' · procédure apprise, pas encore confirmée')}
            </p>
            <p className="mt-0.5 font-semibold">{r.title}</p>
            {r.cause && <p className="mt-1 text-slate-600"><span className="font-semibold">Cause :</span> {r.cause}</p>}
            <p className="mt-1 whitespace-pre-line text-slate-800"><span className="font-semibold">Solution :</span> {r.solution}</p>
            {(r.origin === 'ia' || r.origin === 'client') && r.status === 'candidate' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void review(r.id, 'trusted')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">Ça a marché : confirmer</button>
                <button type="button" onClick={() => void review(r.id, 'retired')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Écarter</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
