import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, COMPANY_TOKEN_KEY, companyApi } from '../lib/api.js';

interface CompanyInfo {
  id: string;
  name: string;
  subscription_status: string;
  plan_name: string | null;
  price_fcfa: number | null;
  metadata: Record<string, unknown> | null;
  assigned_technician_name: string | null;
}

interface HelpRequest {
  id: string;
  description: string;
  priority: string;
  status: string;
  created_at: string;
  session_code: string | null;
  session_status: string | null;
}

interface Device {
  id: string;
  device_name: string;
  platform: string;
  disk_free_percent: number | null;
  antivirus_ok: boolean | null;
  os_up_to_date: boolean | null;
  last_seen_at: string | null;
}

interface CompanyUser {
  id: string;
  full_name: string;
  username: string;
  role: string;
  is_active: boolean;
}

interface Report {
  requestsThisMonth: number;
  resolvedThisMonth: number;
  avgResolutionSeconds: number | null;
  riskyDevices: Array<{ device_name: string }>;
}

export function CompanyPage() {
  const [token, setToken] = useState<string | null>(localStorage.getItem(COMPANY_TOKEN_KEY));
  const [role, setRole] = useState<'admin' | 'employee' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [company, setCompany] = useState<CompanyInfo | null>(null);
  const [helpRequests, setHelpRequests] = useState<HelpRequest[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [helpDescription, setHelpDescription] = useState('');
  const [helpPriority, setHelpPriority] = useState<'normal' | 'urgent'>('normal');
  const [lastSessionCode, setLastSessionCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await companyApi.get<{ company: CompanyInfo; role: 'admin' | 'employee' }>('/api/company/me');
      setCompany(me.company);
      setRole(me.role);

      const [requestsRes, devicesRes] = await Promise.all([
        companyApi.get<{ helpRequests: HelpRequest[] }>('/api/company/help-requests'),
        companyApi.get<{ devices: Device[] }>('/api/company/devices'),
      ]);
      setHelpRequests(requestsRes.helpRequests);
      setDevices(devicesRes.devices);

      if (me.role === 'admin') {
        const [usersRes, reportRes] = await Promise.all([
          companyApi.get<{ users: CompanyUser[] }>('/api/company/users'),
          companyApi.get<Report>('/api/company/report'),
        ]);
        setUsers(usersRes.users);
        setReport(reportRes);
      }
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem(COMPANY_TOKEN_KEY);
        setToken(null);
      } else {
        setError('Impossible de charger votre espace entreprise.');
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
      const res = await companyApi.post<{ token: string }>('/api/auth/company/login', { username, password });
      localStorage.setItem(COMPANY_TOKEN_KEY, res.token);
      setToken(res.token);
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : 'Erreur de connexion.');
    }
  }

  function logout() {
    localStorage.removeItem(COMPANY_TOKEN_KEY);
    setToken(null);
  }

  async function askForHelp(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await companyApi.post<{ session: { session_code: string } }>('/api/company/help-requests', {
        description: helpDescription,
        priority: helpPriority,
      });
      setLastSessionCode(res.session.session_code);
      setHelpDescription('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la demande.');
    }
  }

  if (!token) {
    return (
      <div className="ta-container flex min-h-[70vh] max-w-md items-center py-14">
        <div className="ta-card w-full p-8">
          <p className="ta-eyebrow mb-2">Espace entreprise</p>
          <h1 className="mb-6 text-2xl font-bold">Connexion</h1>
          <form onSubmit={login} className="space-y-4">
            <input
              required
              placeholder="Identifiant"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="ta-input"
            />
            <input
              required
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="ta-input"
            />
            {loginError && <p className="text-sm text-red-600">{loginError}</p>}
            <button type="submit" className="ta-button-primary w-full">
              Se connecter
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{company?.name ?? 'Espace entreprise'}</h1>
          {company && (
            <p className="text-sm text-slate-500">
              {company.plan_name} · statut {company.subscription_status}
              {company.assigned_technician_name && ` · technicien attitré : ${company.assigned_technician_name}`}
            </p>
          )}
        </div>
        <button onClick={logout} className="text-sm text-slate-500 hover:underline">
          Déconnexion
        </button>
      </div>

      {error && <p className="text-red-600">{error}</p>}

      <section className="rounded-lg border bg-white p-5">
        <h2 className="font-semibold mb-3">Demander de l'aide</h2>
        {lastSessionCode && (
          <p className="mb-3 rounded bg-green-50 p-3 text-sm text-green-800">
            Demande envoyée — code de session {lastSessionCode}.{' '}
            <Link to={`/session?code=${lastSessionCode}`} className="underline">
              Suivre la session
            </Link>
          </p>
        )}
        <form onSubmit={askForHelp} className="space-y-3">
          <textarea
            required
            minLength={5}
            placeholder="Décrivez le problème"
            value={helpDescription}
            onChange={(e) => setHelpDescription(e.target.value)}
            className="w-full rounded-lg border px-3 py-2"
            rows={3}
          />
          <select
            value={helpPriority}
            onChange={(e) => setHelpPriority(e.target.value as 'normal' | 'urgent')}
            className="rounded-lg border px-3 py-2"
          >
            <option value="normal">Priorité normale</option>
            <option value="urgent">Urgent</option>
          </select>
          <button type="submit" className="block rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700">
            Envoyer la demande
          </button>
        </form>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Historique des demandes</h2>
        <ul className="space-y-2">
          {helpRequests.map((r) => (
            <li key={r.id} className="rounded-lg border bg-white p-3 text-sm">
              <p className="font-medium">{r.description}</p>
              <p className="text-slate-500">
                {r.priority} · {r.status} {r.session_code && `· session ${r.session_code}`}
              </p>
            </li>
          ))}
          {helpRequests.length === 0 && <p className="text-sm text-slate-500">Aucune demande pour l'instant.</p>}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-3">Parc informatique</h2>
        <p className="text-xs text-slate-500 mb-3">
          TA[MANQUANT] : l'agent permanent qui alimente cet inventaire automatiquement n'est pas encore construit
          (nécessite un pipeline de build Windows dédié). En attendant, un poste peut être ajouté manuellement.
        </p>
        <table className="w-full text-sm border rounded-lg overflow-hidden">
          <thead className="bg-slate-100">
            <tr>
              <th className="text-left p-2">Poste</th>
              <th className="text-left p-2">Disque libre</th>
              <th className="text-left p-2">Antivirus</th>
              <th className="text-left p-2">À jour</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-2">{d.device_name}</td>
                <td className="p-2">{d.disk_free_percent != null ? `${d.disk_free_percent}%` : '—'}</td>
                <td className="p-2">{d.antivirus_ok == null ? '—' : d.antivirus_ok ? 'Oui' : 'Non'}</td>
                <td className="p-2">{d.os_up_to_date == null ? '—' : d.os_up_to_date ? 'Oui' : 'Non'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {role === 'admin' && report && (
        <section className="rounded-lg border bg-white p-5">
          <h2 className="font-semibold mb-3">Rapport du mois</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-slate-500">Demandes</p>
              <p className="text-xl font-bold">{report.requestsThisMonth}</p>
            </div>
            <div>
              <p className="text-slate-500">Résolues</p>
              <p className="text-xl font-bold">{report.resolvedThisMonth}</p>
            </div>
            <div>
              <p className="text-slate-500">Postes à risque</p>
              <p className="text-xl font-bold">{report.riskyDevices.length}</p>
            </div>
          </div>
        </section>
      )}

      {role === 'admin' && (
        <section>
          <h2 className="font-semibold mb-3">Équipe</h2>
          <ul className="space-y-1 text-sm">
            {users.map((u) => (
              <li key={u.id} className="rounded border bg-white p-2">
                {u.full_name} · {u.username} · {u.role}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
