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
    <div className="ta-container max-w-xl py-14">
      <p className="ta-eyebrow mb-2">Diagnostic</p>
      <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Démarrer une assistance</h1>
      <p className="mb-8 text-slate-600">
        Choisissez une formule, indiquez votre numéro, puis réglez par Mobile Money.
      </p>

      <form onSubmit={submit} className="ta-card space-y-4 p-6 sm:p-8">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Formule</label>
          <select
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            className="ta-input"
          >
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.price_fcfa.toLocaleString('fr-FR')} FCFA
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Appareil concerné</label>
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value as 'windows' | 'android')}
            className="ta-input"
          >
            <option value="windows">Ordinateur Windows</option>
            <option value="android">Téléphone / tablette Android</option>
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Votre numéro de téléphone</label>
          <input
            required
            placeholder="+225 07 00 00 00 00"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="ta-input"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Votre nom (optionnel)</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="ta-input"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="ta-button-primary w-full disabled:opacity-50"
        >
          {loading ? 'Création de la commande…' : 'Continuer vers le paiement'}
        </button>
      </form>
    </div>
  );
}
