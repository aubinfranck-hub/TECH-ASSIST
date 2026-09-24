import { useEffect, useState } from 'react';
import { api, ApiError, type PricingPlan } from '../lib/api.js';

interface Props {
  pmePlans: PricingPlan[];
  onCreated: () => void;
}

export function CreateCompanyForm({ pmePlans, onCreated }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [planId, setPlanId] = useState(pmePlans[0]?.id ?? '');

  // pmePlans arrive de manière asynchrone (chargement initial de l'admin) :
  // sans cet effet, un planId vide au premier rendu resterait vide pour toujours.
  useEffect(() => {
    if (!planId && pmePlans.length > 0) setPlanId(pmePlans[0].id);
  }, [pmePlans, planId]);
  const [adminFullName, setAdminFullName] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ adminUsername: string; adminPassword: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ adminUsername: string; adminPassword: string }>('/api/admin/companies', {
        name,
        phone,
        subscriptionPlanId: planId,
        adminFullName,
        adminPhone,
        adminUsername,
      });
      setCreated(res);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    }
  }

  if (created) {
    return (
      <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
        <p>Entreprise créée. Identifiants du compte administrateur (à transmettre, non réaffichés) :</p>
        <p className="mt-2 font-mono">
          {created.adminUsername} / {created.adminPassword}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 rounded-lg border bg-white p-4">
      <input required placeholder="Nom de l'entreprise" value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border px-3 py-2" />
      <input required placeholder="Téléphone entreprise" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-lg border px-3 py-2" />
      <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="rounded-lg border px-3 py-2 sm:col-span-2">
        {pmePlans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.price_fcfa.toLocaleString('fr-FR')} FCFA/mois
          </option>
        ))}
      </select>
      <input required placeholder="Nom du dirigeant" value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} className="rounded-lg border px-3 py-2" />
      <input required placeholder="Téléphone du dirigeant" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} className="rounded-lg border px-3 py-2" />
      <input required placeholder="Identifiant de connexion" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} className="rounded-lg border px-3 py-2 sm:col-span-2" />
      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
      <button type="submit" className="sm:col-span-2 rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">
        Créer l'entreprise
      </button>
    </form>
  );
}
