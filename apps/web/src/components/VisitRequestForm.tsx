import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';

export function VisitRequestForm() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      await api.post('/api/visits/requests', { fullName, phone, address, description });
      setStatus('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur, veuillez réessayer.');
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <p className="rounded-lg bg-green-50 p-4 text-green-800">
        Demande envoyée ! Nous vous proposons un créneau et un devis (RV-01 à RV-03).
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <input
        required
        placeholder="Nom complet"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        className="rounded-lg border px-3 py-2"
      />
      <input
        required
        placeholder="Téléphone (+225...)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="rounded-lg border px-3 py-2"
      />
      <input
        required
        placeholder="Adresse (quartier, ville)"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        className="sm:col-span-2 rounded-lg border px-3 py-2"
      />
      <textarea
        required
        placeholder="Décrivez le problème (réseau, installation, réinstallation...)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="sm:col-span-2 rounded-lg border px-3 py-2"
        rows={3}
      />
      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="sm:col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {status === 'sending' ? 'Envoi…' : 'Demander une visite'}
      </button>
    </form>
  );
}
