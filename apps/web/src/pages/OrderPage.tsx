import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Order, type SessionInfo } from '../lib/api.js';

interface Diagnostic {
  id: string;
  ai_result: {
    summary: string;
    likelyCauses: string[];
    recommendedActions: string[];
    confidence: number;
    requiresRemoteSession: boolean;
    outOfScope: boolean;
  };
  source: 'gemini' | 'local_engine';
}

export function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await api.get<{ order: Order }>(`/api/orders/${orderId}`);
      setOrder(res.order);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Commande introuvable.');
    }
  }, [orderId]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 4000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function submitDiagnostic(e: React.FormEvent) {
    e.preventDefault();
    if (!orderId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<{ diagnostic: Diagnostic }>(`/api/orders/${orderId}/diagnostic`, {
        platform: order?.platform ?? 'windows',
        problemDescription: description,
        answers: {},
      });
      setDiagnostic(res.diagnostic);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors du diagnostic.');
    } finally {
      setSubmitting(false);
    }
  }

  async function createSession() {
    if (!orderId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post<{ session: SessionInfo }>(`/api/orders/${orderId}/session`, {
        platform: 'web',
      });
      navigate(`/session?code=${res.session.session_code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la création de la session.');
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !order) {
    return <div className="ta-container py-14"><div className="ta-card p-6 text-center text-sm text-red-600">{error}</div></div>;
  }
  if (!order) {
    return <div className="ta-container py-14"><div className="ta-card p-6 text-center text-sm text-slate-500">Chargement de votre commande…</div></div>;
  }

  const isDiagnosticPlan = order.duration_minutes == null;
  const paid = order.status === 'paid';

  return (
    <div className="min-h-[70vh] bg-slate-50">
      <div className="ta-container max-w-4xl py-8 sm:py-12 lg:py-16">
        <div className="mb-7 flex items-start justify-between gap-4 sm:mb-9">
          <div>
            <span className="ta-eyebrow">Tech Assist · Commande</span>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl lg:text-4xl">
              Votre commande
            </h1>
            <p className="mt-2 text-sm text-slate-500 sm:text-base">
              {order.plan_name} <span className="mx-1 text-slate-300">•</span>
              <strong className="text-slate-900">{order.amount_fcfa.toLocaleString('fr-FR')} FCFA</strong>
            </p>
          </div>
          <div className="hidden shrink-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-card sm:block">
            <img src="/logo-mark.svg" alt="" className="h-9 w-9" />
          </div>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-3">
          {[
            ['01', 'Commande', true],
            ['02', 'Paiement', paid,],
            ['03', isDiagnosticPlan ? 'Diagnostic' : 'Session', paid],
          ].map(([number, label, active]) => (
            <div key={String(number)} className={`rounded-xl border p-3 sm:rounded-2xl sm:p-4 ${active ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center gap-2">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black ${active ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{number}</span>
                <span className={`text-[11px] font-bold sm:text-xs ${active ? 'text-brand-800' : 'text-slate-500'}`}>{label}</span>
              </div>
            </div>
          ))}
        </div>

        {order.status === 'pending_payment' && (
          <section className="overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-card sm:rounded-3xl">
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-5 sm:px-7">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-lg">₣</span>
                <div>
                  <h2 className="font-bold text-amber-950">En attente de paiement</h2>
                  <p className="mt-1 text-sm leading-6 text-amber-800">Votre commande est créée. Effectuez le paiement Mobile Money pour continuer.</p>
                </div>
              </div>
            </div>
            <div className="p-5 sm:p-7">
              <div className="rounded-2xl bg-slate-50 p-4 sm:p-5">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Montant à régler</p>
                <p className="mt-1 text-2xl font-black text-slate-950 sm:text-3xl">{order.amount_fcfa.toLocaleString('fr-FR')} <span className="text-sm">FCFA</span></p>
              </div>
              <p className="mt-5 text-sm leading-6 text-slate-600">
                Réglez par Mobile Money. Un technicien confirme actuellement la réception du paiement.
                Cette page se met à jour automatiquement.
              </p>
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Référence de commande</p>
                <p className="mt-1 break-all font-mono text-xs text-slate-700">{order.id}</p>
              </div>
            </div>
          </section>
        )}

        {paid && isDiagnosticPlan && !diagnostic && (
          <section className="ta-card overflow-hidden">
            <div className="border-b border-green-100 bg-green-50 px-5 py-4 sm:px-7">
              <p className="text-sm font-bold text-green-800">✓ Paiement confirmé</p>
            </div>
            <form onSubmit={submitDiagnostic} className="p-5 sm:p-7">
              <h2 className="text-xl font-black text-slate-950">Décrivez votre problème</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Décrivez ce qui ne fonctionne pas. Notre diagnostic vous guidera vers la suite.</p>
              <label className="mt-6 block text-sm font-semibold text-slate-800">Votre problème</label>
              <textarea
                required minLength={5} rows={5} value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="ta-input mt-2 min-h-32 resize-y"
                placeholder="Ex. : mon ordinateur est très lent depuis quelques jours…"
              />
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={submitting} className="ta-button-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? 'Analyse en cours…' : 'Obtenir mon diagnostic'}
              </button>
            </form>
          </section>
        )}

        {diagnostic && (
          <section className="ta-card p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="ta-eyebrow">{diagnostic.source === 'gemini' ? 'Diagnostic IA' : 'Diagnostic de secours'}</p>
              <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">Confiance {diagnostic.ai_result.confidence}%</span>
            </div>
            <p className="mt-4 text-base font-semibold leading-7 text-slate-900">{diagnostic.ai_result.summary}</p>
            {diagnostic.ai_result.likelyCauses.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-bold text-slate-900">Causes probables</p>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">{diagnostic.ai_result.likelyCauses.map((c) => <li key={c} className="flex gap-2"><span className="text-brand-600">•</span>{c}</li>)}</ul>
              </div>
            )}
            {diagnostic.ai_result.recommendedActions.length > 0 && (
              <div className="mt-6">
                <p className="text-sm font-bold text-slate-900">Actions recommandées</p>
                <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-600">{diagnostic.ai_result.recommendedActions.map((a) => <li key={a} className="flex gap-2"><span className="text-brand-600">•</span>{a}</li>)}</ul>
              </div>
            )}
            {diagnostic.ai_result.outOfScope && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Ce problème semble matériel : une intervention sur place peut être nécessaire.</p>}
          </section>
        )}

        {paid && !isDiagnosticPlan && (
          <section className="ta-card p-5 sm:p-7">
            <div className="rounded-xl bg-green-50 p-4 text-sm font-bold text-green-800">✓ Paiement confirmé</div>
            <button onClick={createSession} disabled={submitting} className="ta-button-primary mt-5 w-full disabled:opacity-50">
              {submitting ? 'Création de la session…' : 'Démarrer ma session'}
            </button>
          </section>
        )}

        {order.status === 'refunded' && (
          <div className="ta-card p-5 text-sm text-slate-600">Cette commande a été remboursée.</div>
        )}
      </div>
    </div>
  );
}
