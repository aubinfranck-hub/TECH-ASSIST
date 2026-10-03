import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';

/** Demande de compte partenaire : le compte s'ouvre quand l'équipe l'a validé. */
export function PartnerRegisterForm() {
  const [form, setForm] = useState({ fullName: '', businessName: '', phone: '', username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/partner/register', { ...form, businessName: form.businessName || undefined });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur, réessayez.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="font-bold">Demande reçue.</p>
        <p className="mt-1">Notre équipe la valide, puis vous pourrez vous connecter avec votre identifiant. Pensez à activer la double authentification à votre première connexion.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input required placeholder="Nom et prénom" value={form.fullName} onChange={set('fullName')} className="ta-input" />
      <input placeholder="Nom de votre activité (facultatif)" value={form.businessName} onChange={set('businessName')} className="ta-input" />
      <input required inputMode="tel" placeholder="Téléphone (ex. +2250700000000)" value={form.phone} onChange={set('phone')} className="ta-input" />
      <input required autoCapitalize="none" placeholder="Identifiant de connexion" value={form.username} onChange={set('username')} className="ta-input" />
      <input required type="password" minLength={10} placeholder="Mot de passe (10 caractères minimum)" value={form.password} onChange={set('password')} className="ta-input" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="ta-button-primary w-full disabled:opacity-60">
        Demander mon compte partenaire
      </button>
    </form>
  );
}
