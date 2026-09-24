import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';

interface QueueItem {
  id: string;
  session_code: string;
  platform: string;
  created_at: string;
  duration_minutes: number;
  client_phone: string;
  client_name: string | null;
}

interface TechOrder {
  id: string;
  client_phone: string;
  client_name: string | null;
  status: string;
  amount_fcfa: number;
  plan_name: string;
  created_at: string;
}

export function TechnicianPage() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('tech_assist_token'));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState<TechOrder[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [queueRes, ordersRes] = await Promise.all([
        api.get<{ queue: QueueItem[] }>('/api/technician/queue'),
        api.get<{ orders: TechOrder[] }>('/api/orders/pending-payment').catch(() => ({ orders: [] })),
      ]);
      setQueue(queueRes.queue);
      setPendingOrders(ordersRes.orders);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem('tech_assist_token');
        setToken(null);
      } else {
        setError('Impossible de charger la file d\'attente.');
      }
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
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

  function logout() {
    localStorage.removeItem('tech_assist_token');
    setToken(null);
  }

  async function claim(sessionId: string) {
    await api.patch(`/api/technician/sessions/${sessionId}/claim`);
    refresh();
  }

  async function confirmPayment(orderId: string) {
    await api.post(`/api/orders/${orderId}/confirm-payment`);
    refresh();
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-sm px-4 py-14">
        <h1 className="text-2xl font-bold mb-4">Espace technicien</h1>
        <form onSubmit={login} className="space-y-3">
          <input
            required
            placeholder="Identifiant"
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
    <div className="mx-auto max-w-3xl px-4 py-14">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Console technicien</h1>
        <button onClick={logout} className="text-sm text-slate-500 hover:underline">
          Déconnexion
        </button>
      </div>

      {error && <p className="text-red-600 mb-4">{error}</p>}

      <section className="mb-10">
        <h2 className="font-semibold mb-3">Paiements en attente de confirmation</h2>
        {pendingOrders.length === 0 && <p className="text-sm text-slate-500">Aucun paiement en attente.</p>}
        <ul className="space-y-2">
          {pendingOrders.map((o) => (
            <li key={o.id} className="flex items-center justify-between rounded-lg border bg-white p-3">
              <div>
                <p className="font-medium">
                  {o.plan_name} — {o.amount_fcfa.toLocaleString('fr-FR')} FCFA
                </p>
                <p className="text-sm text-slate-500">
                  {o.client_name ?? 'Client'} · {o.client_phone}
                </p>
              </div>
              <button
                onClick={() => confirmPayment(o.id)}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
              >
                Paiement reçu
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-semibold mb-3">File d'attente</h2>
        {queue.length === 0 && <p className="text-sm text-slate-500">Aucune demande en attente.</p>}
        <ul className="space-y-2">
          {queue.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-lg border bg-white p-3">
              <div>
                <p className="font-medium">Code {s.session_code}</p>
                <p className="text-sm text-slate-500">
                  {s.client_name ?? 'Client'} · {s.client_phone} · {s.platform}
                </p>
              </div>
              <button
                onClick={() => claim(s.id)}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white hover:bg-brand-700"
              >
                Prendre en charge
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
