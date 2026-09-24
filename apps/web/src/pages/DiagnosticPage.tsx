import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type Order, type PricingPlan } from '../lib/api.js';

export function DiagnosticPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [planId, setPlanId] = useState('diagnostic_express');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<'windows' | 'android'>('windows');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<{ plans: PricingPlan[] }>('/api/pricing')
      .then((res) => setPlans(res.plans.filter((p) => p.segment === 'particulier')));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { order } = await api.post<{ order: Order }>('/api/orders', {
        clientPhone: phone,
        clientName: name || undefined,
        planId,
        platform,
      });
      navigate(`/commande/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la commande.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-14">
      <h1 className="text-2xl font-bold mb-2">Démarrer une assistance</h1>
      <p className="text-slate-600 mb-8">
        Choisissez une formule, indiquez votre numéro, puis réglez par Mobile Money.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Formule</label>
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.price_fcfa.toLocaleString('fr-FR')} FCFA
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Appareil concerné</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'windows' | 'android')}
            className="w-full rounded-lg border px-3 py-2"
          >
            <option value="windows">Ordinateur Windows</option>
            <option value="android">Téléphone / tablette Android</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Votre numéro de téléphone</label>
          <input
            required
            placeholder="+225 07 00 00 00 00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Votre nom (optionnel)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 px-4 py-3 text-white font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? 'Création de la commande…' : 'Continuer vers le paiement'}
        </button>
      </form>
    </div>
  );
}
