import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type EarningStatus, type TechnicianEarnings } from '../lib/api.js';

const OPERATORS: Record<string, string> = { wave: 'Wave', orange: 'Orange Money', mtn: 'MTN MoMo', moov: 'Moov Money', djamo: 'Djamo' };
const STATUS: Record<EarningStatus, { label: string; tone: string }> = {
  pending: { label: 'En validation', tone: 'bg-amber-50 text-amber-800' },
  approved: { label: 'À recevoir', tone: 'bg-brand-50 text-brand-700' },
  paid: { label: 'Versé', tone: 'bg-emerald-50 text-emerald-800' },
  cancelled: { label: 'Écarté', tone: 'bg-slate-100 text-slate-500' },
};
const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

/** Ce que le technicien a gagné pour ses assistances terminées : en validation, à recevoir, déjà versé. */
export function TechnicianEarningsCard() {
  const [data, setData] = useState<TechnicianEarnings | null>(null);
  const [operator, setOperator] = useState('wave');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<TechnicianEarnings>('/api/technician/earnings');
      setData(res);
      if (res.payout.operator) setOperator(res.payout.operator);
      if (res.payout.phone) setPhone(res.payout.phone);
    } catch {
      setError('Impossible de charger vos gains.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.put('/api/technician/payout-profile', { phone, operator });
      setMessage('Numéro enregistré.');
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur, réessayez.');
    }
  }

  if (!data) return error ? <p className="text-sm text-red-600">{error}</p> : null;
  const b = data.balance;

  return (
    <div className="ta-card space-y-4 p-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-amber-50 p-3">
          <p className="text-lg font-extrabold text-amber-800">{fcfa(b.pending)}</p>
          <p className="text-xs text-amber-900">En validation</p>
        </div>
        <div className="rounded-xl bg-brand-50 p-3">
          <p className="text-lg font-extrabold text-brand-700">{fcfa(b.approved)}</p>
          <p className="text-xs text-brand-800">À recevoir</p>
        </div>
        <div className="rounded-xl bg-emerald-50 p-3">
          <p className="text-lg font-extrabold text-emerald-800">{fcfa(b.paid)}</p>
          <p className="text-xs text-emerald-900">Déjà versé</p>
        </div>
      </div>

      <form onSubmit={saveProfile} className="space-y-2">
        <p className="text-sm font-semibold">Où recevoir vos gains</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <select value={operator} onChange={(e) => setOperator(e.target.value)} className="ta-input sm:w-44">
            {Object.entries(OPERATORS).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <input required inputMode="tel" placeholder="Numéro (ex. +2250700000000)" value={phone} onChange={(e) => setPhone(e.target.value)} className="ta-input flex-1" />
          <button type="submit" className="ta-button-secondary">
            Enregistrer
          </button>
        </div>
        {message && <p className="text-sm text-emerald-700">{message}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      <div>
        <p className="mb-2 text-sm font-semibold">Mes dernières assistances</p>
        {data.earnings.length === 0 && <p className="text-sm text-slate-500">Vos gains apparaîtront ici à la fin de chaque assistance.</p>}
        <ul className="divide-y divide-slate-100">
          {data.earnings.slice(0, 10).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{e.label}</p>
                <p className="text-xs text-slate-500">
                  {new Date(e.createdAt).toLocaleDateString('fr-FR')} · session …{e.code}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-bold">{fcfa(e.amountFcfa)}</p>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[e.status].tone}`}>{STATUS[e.status].label}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {data.payouts.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Versements reçus</p>
          <ul className="space-y-1 text-sm text-slate-600">
            {data.payouts.map((p) => (
              <li key={p.id} className="flex justify-between gap-3">
                <span>
                  {new Date(p.paidAt).toLocaleDateString('fr-FR')} · réf. {p.reference}
                </span>
                <span className="font-semibold">{fcfa(p.amountFcfa)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
