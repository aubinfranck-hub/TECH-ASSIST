import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';

export function PmeRequestForm() {
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [computersCount, setComputersCount] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      await api.post('/api/pme/requests', {
        companyName,
        contactName,
        phone,
        computersCount: computersCount ? Number(computersCount) : undefined,
      });
      setStatus('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur, veuillez réessayer.');
      setStatus('error');
    }
  }

  if (status === 'done') {
    return (
      <p className="rounded-lg bg-green-50 p-4 text-green-800">
        Merci ! Un conseiller vous contacte sous peu pour discuter de votre abonnement PME.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <input
        required
        placeholder="Nom de l'entreprise"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        className="rounded-lg border px-3 py-2"
      />
      <input
        required
        placeholder="Votre nom"
        value={contactName}
        onChange={(e) => setContactName(e.target.value)}
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
        type="number"
        min={1}
        placeholder="Nombre d'ordinateurs (optionnel)"
        value={computersCount}
        onChange={(e) => setComputersCount(e.target.value)}
        className="rounded-lg border px-3 py-2"
      />
      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === 'sending'}
        className="sm:col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {status === 'sending' ? 'Envoi…' : 'Être rappelé'}
      </button>
    </form>
  );
}
