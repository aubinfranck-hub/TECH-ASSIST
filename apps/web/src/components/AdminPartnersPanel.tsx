import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

interface Partner {
  id: string;
  full_name: string;
  phone: string;
  username: string;
  business_name: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  is_active: boolean;
  totp_enabled: boolean;
  sessions: number;
  paid_sessions: number;
}
interface Earning {
  id: string;
  technician_name: string;
  label: string;
  amount_fcfa: number;
  status: string;
  note: string | null;
  created_at: string;
  session_code: string;
  evidence: { technicianMessages?: number; remoteAccessViewed?: boolean; minutes?: number; clientPaidFcfa?: number; selfConfirmedPayment?: boolean };
}
interface Balance {
  id: string;
  full_name: string;
  payout_phone: string | null;
  payout_operator: string | null;
  pending: number;
  approved: number;
  paid: number;
}
interface Rate {
  kind: string;
  label: string;
  amount_fcfa: number;
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

/** Partenaires à valider, gains à valider, versements, grille de rémunération. */
export function AdminPartnersPanel() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [references, setReferences] = useState<Record<string, string>>({});
  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, e, b, r] = await Promise.all([
        api.get<{ partners: Partner[] }>('/api/admin/partners'),
        api.get<{ earnings: Earning[] }>('/api/admin/earnings?status=pending'),
        api.get<{ balances: Balance[] }>('/api/admin/earnings/balances'),
        api.get<{ rates: Rate[] }>('/api/admin/pay-rates'),
      ]);
      setPartners(p.partners);
      setEarnings(e.earnings);
      setBalances(b.balances);
      setRates(r.rates);
    } catch {
      setError('Impossible de charger les partenaires et les gains.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action impossible.');
    }
    void load();
  }

  const decide = (id: string, decision: string) => act(() => api.post(`/api/admin/partners/${id}/decision`, { decision }));
  const approveAll = () => act(() => api.post('/api/admin/earnings/approve', { ids: earnings.map((e) => e.id).slice(0, 100) }));
  const approveOne = (id: string) => act(() => api.post('/api/admin/earnings/approve', { ids: [id] }));
  const cancelOne = (id: string) => {
    const note = window.prompt("Pourquoi écarter ce gain ? (obligatoire)");
    if (note && note.trim().length >= 3) void act(() => api.post(`/api/admin/earnings/${id}/cancel`, { note }));
  };
  const payout = (id: string) => act(() => api.post(`/api/admin/technicians/${id}/payouts`, { reference: references[id] ?? '' }));
  const saveRate = (kind: string) => act(() => api.put(`/api/admin/pay-rates/${kind}`, { amountFcfa: Number(rateInputs[kind]) }));

  return (
    <div className="space-y-10">
      {error && <p className="text-red-600">{error}</p>}

      <section>
        <h2 className="mb-3 font-semibold">Techniciens partenaires</h2>
        {partners.length === 0 && <p className="text-sm text-slate-500">Aucune demande pour le moment.</p>}
        <ul className="space-y-2">
          {partners.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-xl border bg-white p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-semibold">
                  {p.full_name} {p.business_name && <span className="font-normal text-slate-500">· {p.business_name}</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {p.phone} · @{p.username} · {p.sessions} session(s), {p.paid_sessions} payée(s) · 2FA {p.totp_enabled ? 'oui' : 'non'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {p.approval_status === 'pending' && (
                  <>
                    <button onClick={() => void decide(p.id, 'approve')} className="rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white">
                      Valider
                    </button>
                    <button onClick={() => void decide(p.id, 'reject')} className="rounded-lg border px-3 py-1.5">
                      Refuser
                    </button>
                  </>
                )}
                {p.approval_status === 'approved' && p.is_active && (
                  <button onClick={() => void decide(p.id, 'suspend')} className="rounded-lg border px-3 py-1.5">
                    Suspendre
                  </button>
                )}
                {p.approval_status === 'approved' && !p.is_active && (
                  <button onClick={() => void decide(p.id, 'reactivate')} className="rounded-lg border px-3 py-1.5">
                    Réactiver
                  </button>
                )}
                {p.approval_status === 'rejected' && <span className="text-xs text-slate-500">Refusé</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">Gains à valider ({earnings.length})</h2>
          {earnings.length > 0 && (
            <button onClick={() => void approveAll()} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-bold text-white">
              Tout valider
            </button>
          )}
        </div>
        {earnings.length === 0 && <p className="text-sm text-slate-500">Rien à valider.</p>}
        <ul className="space-y-2">
          {earnings.map((e) => (
            <li key={e.id} className="rounded-xl border bg-white p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {e.technician_name} · {e.label}
                  </p>
                  <p className="text-xs text-slate-500">
                    session …{e.session_code.slice(-4)} · {new Date(e.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · client a payé {fcfa(e.evidence.clientPaidFcfa ?? 0)} · {e.evidence.minutes ?? 0} min ·{' '}
                    {e.evidence.technicianMessages ?? 0} message(s) · accès à distance {e.evidence.remoteAccessViewed ? 'consulté' : 'non consulté'}
                  </p>
                  {e.evidence.selfConfirmedPayment && <p className="mt-1 text-xs font-bold text-red-700">Paiement confirmé à la main par ce même technicien : à vérifier.</p>}
                </div>
                <p className="shrink-0 font-bold">{fcfa(e.amount_fcfa)}</p>
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={() => void approveOne(e.id)} className="rounded-lg bg-brand-600 px-3 py-1 font-bold text-white">
                  Valider
                </button>
                <button onClick={() => cancelOne(e.id)} className="rounded-lg border px-3 py-1">
                  Écarter
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Soldes et versements</h2>
        {balances.length === 0 && <p className="text-sm text-slate-500">Aucun gain pour le moment.</p>}
        <ul className="space-y-2">
          {balances.map((b) => (
            <li key={b.id} className="rounded-xl border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{b.full_name}</p>
                  <p className="text-xs text-slate-500">
                    {b.payout_phone ? `${b.payout_operator} ${b.payout_phone}` : 'Numéro de versement non renseigné'} · en validation {fcfa(b.pending)} · déjà versé {fcfa(b.paid)}
                  </p>
                </div>
                <p className="font-bold text-brand-700">À verser : {fcfa(b.approved)}</p>
              </div>
              {b.approved > 0 && (
                <div className="mt-2 flex gap-2">
                  <input
                    placeholder="Référence du transfert (Wave, Orange…)"
                    value={references[b.id] ?? ''}
                    onChange={(ev) => setReferences({ ...references, [b.id]: ev.target.value })}
                    className="min-w-0 flex-1 rounded-lg border px-3 py-1.5"
                  />
                  <button disabled={(references[b.id] ?? '').trim().length < 3} onClick={() => void payout(b.id)} className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 font-bold text-white disabled:opacity-50">
                    J'ai versé
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Grille de rémunération (par assistance terminée)</h2>
        <ul className="space-y-2">
          {rates.map((r) => (
            <li key={r.kind} className="flex items-center justify-between gap-3 rounded-xl border bg-white p-3 text-sm">
              <span className="min-w-0 flex-1">{r.label}</span>
              <input
                type="number"
                min={0}
                value={rateInputs[r.kind] ?? String(r.amount_fcfa)}
                onChange={(ev) => setRateInputs({ ...rateInputs, [r.kind]: ev.target.value })}
                className="w-28 rounded-lg border px-2 py-1.5 text-right"
              />
              <span className="text-slate-500">FCFA</span>
              <button onClick={() => void saveRate(r.kind)} className="rounded-lg border px-3 py-1.5">
                Enregistrer
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Un nouveau montant ne vaut que pour les assistances à venir.</p>
      </section>
    </div>
  );
}
