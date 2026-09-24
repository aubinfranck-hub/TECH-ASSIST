import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type PricingPlan } from '../lib/api.js';

interface Application {
  id: string;
  full_name: string;
  phone: string;
  skills: string | null;
  status: string;
  created_at: string;
}

interface PmeRequest {
  id: string;
  company_name: string;
  contact_name: string;
  phone: string;
  computers_count: number | null;
  status: string;
  created_at: string;
}

interface AuditLog {
  id: string;
  actor_type: string;
  action: string;
  created_at: string;
}

export function AdminPage() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('tech_assist_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [pmeRequests, setPmeRequests] = useState<PmeRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [pricing, apps, pme, logs] = await Promise.all([
        api.get<{ plans: PricingPlan[] }>('/api/pricing'),
        api.get<{ applications: Application[] }>('/api/admin/technician-applications'),
        api.get<{ requests: PmeRequest[] }>('/api/admin/pme-requests'),
        api.get<{ logs: AuditLog[] }>('/api/admin/audit-logs'),
      ]);
      setPlans(pricing.plans);
      setApplications(apps.applications);
      setPmeRequests(pme.requests);
      setAuditLogs(logs.logs);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem('tech_assist_token');
        setToken(null);
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Ce compte n\'a pas les droits administrateur.');
      } else {
        setError('Impossible de charger les données admin.');
      }
    }
  }, []);

  useEffect(() => {
    if (token) refresh();
  }, [token, refresh]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    try {
      const res = await api.post<{ token: string }>('/api/auth/technician/login', { username, password });
      localStorage.setItem('tech_assist_token', res.token);
      setToken(res.token);
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : 'Erreur de connexion.');
    }
  }

  async function updatePlan(plan: PricingPlan, priceFcfa: number) {
    await api.put(`/api/admin/pricing/${plan.id}`, {
      name: plan.name,
      segment: plan.segment,
      priceFcfa,
      durationMinutes: plan.duration_minutes ?? undefined,
      description: plan.description,
      active: true,
      sortOrder: 0,
    });
    refresh();
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-sm px-4 py-14">
        <h1 className="text-2xl font-bold mb-4">Administration</h1>
        <form onSubmit={login} className="space-y-3">
          <input
            required
            placeholder="Identifiant admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
          <input
            required
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
          />
          {loginError && <p className="text-sm text-red-600">{loginError}</p>}
          <button type="submit" className="w-full rounded-lg bg-brand-600 px-4 py-3 text-white font-medium hover:bg-brand-700">
            Se connecter
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 space-y-12">
      <h1 className="text-2xl font-bold">Administration</h1>
      {error && <p className="text-red-600">{error}</p>}

      <section>
        <h2 className="font-semibold mb-3">Tarifs (RF-41)</h2>
        <table className="w-full text-sm border rounded-lg overflow-hidden">
          <thead className="bg-slate-100">
            <tr>
              <th className="text-left p-2">Formule</th>
              <th className="text-left p-2">Prix (FCFA)</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <PlanRow key={plan.id} plan={plan} onSave={(price) => updatePlan(plan, price)} />
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Candidatures techniciens (RT-01)</h2>
        <ul className="space-y-1 text-sm">
          {applications.map((a) => (
            <li key={a.id} className="rounded border bg-white p-2">
              {a.full_name} · {a.phone} · <span className="text-slate-500">{a.status}</span>
            </li>
          ))}
          {applications.length === 0 && <p className="text-slate-500">Aucune candidature.</p>}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Demandes PME (RP-01)</h2>
        <ul className="space-y-1 text-sm">
          {pmeRequests.map((r) => (
            <li key={r.id} className="rounded border bg-white p-2">
              {r.company_name} · {r.contact_name} · {r.phone} · <span className="text-slate-500">{r.status}</span>
            </li>
          ))}
          {pmeRequests.length === 0 && <p className="text-slate-500">Aucune demande.</p>}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Journal d'audit (RS-06)</h2>
        <ul className="space-y-1 text-xs font-mono text-slate-600 max-h-64 overflow-auto">
          {auditLogs.map((l) => (
            <li key={l.id}>
              [{new Date(l.created_at).toLocaleString('fr-FR')}] {l.actor_type} → {l.action}
            </li>
          ))}
          {auditLogs.length === 0 && <p className="text-slate-500 font-sans">Aucune entrée.</p>}
        </ul>
      </section>
    </div>
  );
}

function PlanRow({ plan, onSave }: { plan: PricingPlan; onSave: (price: number) => void }) {
  const [price, setPrice] = useState(plan.price_fcfa);
  return (
    <tr className="border-t">
      <td className="p-2">{plan.name}</td>
      <td className="p-2">
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="w-28 rounded border px-2 py-1"
        />
      </td>
      <td className="p-2">
        <button
          onClick={() => onSave(price)}
          className="rounded bg-brand-600 px-3 py-1 text-white text-xs hover:bg-brand-700"
        >
          Enregistrer
        </button>
      </td>
    </tr>
  );
}
