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
    return <p className="mx-auto max-w-xl px-4 py-14 text-red-600">{error}</p>;
  }
  if (!order) {
    return <p className="mx-auto max-w-xl px-4 py-14 text-slate-500">Chargement…</p>;
  }

  const isDiagnosticPlan = order.duration_minutes == null;

  return (
    <div className="mx-auto max-w-xl px-4 py-14">
      <h1 className="text-2xl font-bold mb-2">Votre commande</h1>
      <p className="text-slate-600 mb-6">
        {order.plan_name} — {order.amount_fcfa.toLocaleString('fr-FR')} FCFA
      </p>

      {order.status === 'pending_payment' && (
        <div className="rounded-lg border bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">En attente de paiement</h2>
          <p className="mt-2 text-sm text-amber-800">
            Réglez {order.amount_fcfa.toLocaleString('fr-FR')} FCFA par Mobile Money, puis un
            technicien confirme la réception (mise en place de la confirmation automatique en
            cours — voir décision D3 du cahier des charges). Cette page se met à jour automatiquement.
          </p>
          <p className="mt-3 text-xs text-amber-700">Référence de commande : {order.id}</p>
        </div>
      )}

      {order.status === 'paid' && isDiagnosticPlan && !diagnostic && (
        <form onSubmit={submitDiagnostic} className="space-y-4">
          <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">Paiement confirmé ✓</p>
          <label className="block text-sm font-medium">Décrivez votre problème</label>
          <textarea
            required
            minLength={5}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            placeholder="Ex : mon ordinateur est très lent depuis quelques jours..."
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-3 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Analyse en cours…' : 'Obtenir mon diagnostic'}
          </button>
        </form>
      )}

      {diagnostic && (
        <div className="rounded-lg border bg-white p-5 space-y-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {diagnostic.source === 'gemini' ? 'Diagnostic IA' : 'Diagnostic (moteur de secours)'} ·
            confiance {diagnostic.ai_result.confidence}%
          </p>
          <p className="font-medium">{diagnostic.ai_result.summary}</p>
          {diagnostic.ai_result.likelyCauses.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Causes probables</p>
              <ul className="list-disc pl-5 text-sm text-slate-600">
                {diagnostic.ai_result.likelyCauses.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {diagnostic.ai_result.recommendedActions.length > 0 && (
            <div>
              <p className="text-sm font-semibold">Actions recommandées</p>
              <ul className="list-disc pl-5 text-sm text-slate-600">
                {diagnostic.ai_result.recommendedActions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {diagnostic.ai_result.outOfScope && (
            <p className="text-sm text-amber-700">
              Ce problème semble matériel : une intervention sur place peut être nécessaire.
            </p>
          )}
        </div>
      )}

      {order.status === 'paid' && !isDiagnosticPlan && (
        <div className="space-y-4">
          <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">Paiement confirmé ✓</p>
          <button
            onClick={createSession}
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-3 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Création…' : 'Démarrer ma session'}
          </button>
        </div>
      )}

      {order.status === 'refunded' && (
        <p className="rounded-lg bg-slate-100 p-4 text-slate-600">Cette commande a été remboursée.</p>
      )}
    </div>
  );
}
