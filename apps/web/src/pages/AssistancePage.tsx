import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  ApiError,
  type AssistanceMode,
  type AssistanceResult,
  type Eligibility,
  type Order,
  type PricingPlan,
} from '../lib/api.js';

const PHONE_PATTERN = /^\+?[0-9]{8,15}$/;

const MODES: { id: AssistanceMode; title: string; text: string; badge?: string }[] = [
  {
    id: 'ia',
    title: 'Agent IA',
    text: 'Un agent IA prend la main sur votre appareil avec votre accord, diagnostique et corrige. Immédiat.',
    badge: 'Recommandé',
  },
  {
    id: 'humain',
    title: 'Technicien humain',
    text: 'Un technicien vous assiste à distance : dépannage ou aide sur un logiciel.',
  },
];

export function AssistancePage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AssistanceMode>('ia');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<'windows' | 'android'>('windows');
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState<PricingPlan | null>(null);
  const [needsSubscription, setNeedsSubscription] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastChecked = useRef('');

  useEffect(() => {
    api
      .get<{ plans: PricingPlan[] }>('/api/pricing')
      .then((res) => setSubscriptionPlan(res.plans.find((p) => p.metadata?.subscription) ?? null))
      .catch(() => undefined);
  }, []);

  // Vérifie les droits (offre / abonnement) dès que le numéro est complet.
  useEffect(() => {
    const cleaned = phone.replace(/\s/g, '');
    if (!PHONE_PATTERN.test(cleaned) || cleaned === lastChecked.current) return;
    lastChecked.current = cleaned;
    api
      .post<Eligibility>('/api/assistance/eligibility', { clientPhone: cleaned })
      .then((res) => {
        setEligibility(res);
        setNeedsSubscription(!res.freeOfferAvailable && !res.subscription);
      })
      .catch(() => setEligibility(null));
  }, [phone]);

  const price = subscriptionPlan?.price_fcfa ?? 10000;

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<AssistanceResult>('/api/assistance', {
        clientPhone: phone.replace(/\s/g, ''),
        clientName: name || undefined,
        mode,
        platform,
      });
      navigate(`/session?code=${res.session.session_code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setNeedsSubscription(true);
        setError(null);
      } else {
        setError(err instanceof ApiError ? err.message : "Impossible de démarrer l'assistance.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function subscribe() {
    setLoading(true);
    setError(null);
    try {
      const { order } = await api.post<{ order: Order }>('/api/subscriptions', {
        clientPhone: phone.replace(/\s/g, ''),
        clientName: name || undefined,
        platform: 'web',
      });
      navigate(`/commande/${order.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer l'abonnement.");
    } finally {
      setLoading(false);
    }
  }

  const phoneValid = PHONE_PATTERN.test(phone.replace(/\s/g, ''));

  return (
    <div className="ta-container max-w-xl py-14">
      <p className="ta-eyebrow mb-2">Assistance</p>
      <h1 className="mb-2 text-2xl font-bold sm:text-3xl">Démarrer une assistance</h1>
      <p className="mb-8 text-slate-600">
        Votre première assistance est offerte. Ensuite, un abonnement de{' '}
        {price.toLocaleString('fr-FR')} FCFA par mois vous donne accès à l'assistance, avec l'agent IA ou un technicien.
      </p>

      <form onSubmit={start} className="ta-card space-y-5 p-6 sm:p-8">
        <fieldset>
          <legend className="mb-2 block text-sm font-medium text-slate-700">Qui vous aide ?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODES.map((m) => (
              <label
                key={m.id}
                className={`cursor-pointer rounded-2xl border p-4 transition ${
                  mode === m.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="mode"
                  value={m.id}
                  checked={mode === m.id}
                  onChange={() => setMode(m.id)}
                  className="sr-only"
                />
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-950">{m.title}</span>
                  {m.badge && (
                    <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold text-white">{m.badge}</span>
                  )}
                </span>
                <span className="mt-2 block text-xs leading-5 text-slate-600">{m.text}</span>
              </label>
            ))}
          </div>
          {mode === 'ia' && eligibility && !eligibility.aiAgentAvailable && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              L'agent IA arrive bientôt : en attendant, un technicien prend votre demande en charge.
            </p>
          )}
        </fieldset>

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
            inputMode="tel"
            placeholder="+225 07 00 00 00 00"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setNeedsSubscription(false);
            }}
            className="ta-input"
          />
          {eligibility?.freeOfferAvailable && (
            <p className="mt-2 text-xs font-semibold text-green-700">✓ Votre première assistance est offerte.</p>
          )}
          {eligibility?.subscription && (
            <p className="mt-2 text-xs font-semibold text-green-700">
              ✓ Abonnement actif jusqu'au {new Date(eligibility.subscription.endsAt).toLocaleDateString('fr-FR')}.
            </p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Votre nom (optionnel)</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="ta-input" />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {needsSubscription ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-bold text-amber-950">Votre assistance offerte a été utilisée</p>
            <p className="mt-1 text-sm leading-6 text-amber-800">
              Abonnez-vous pour {price.toLocaleString('fr-FR')} FCFA par mois et gardez l'accès à l'assistance
              (agent IA ou technicien) pendant 30 jours.
            </p>
            <button
              type="button"
              onClick={subscribe}
              disabled={loading || !phoneValid}
              className="ta-button-primary mt-4 w-full disabled:opacity-50"
            >
              {loading ? 'Création…' : `M'abonner — ${price.toLocaleString('fr-FR')} FCFA / mois`}
            </button>
          </div>
        ) : (
          <button type="submit" disabled={loading || !phoneValid} className="ta-button-primary w-full disabled:opacity-50">
            {loading ? 'Démarrage…' : 'Démarrer mon assistance'}
          </button>
        )}
      </form>
    </div>
  );
}
