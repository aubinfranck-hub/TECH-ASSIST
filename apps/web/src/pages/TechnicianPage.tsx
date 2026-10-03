import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ActiveSessionCard, type MySession } from '../components/ActiveSessionCard.js';
import { TechnicianAlerts } from '../components/TechnicianAlerts.js';
import { TechnicianLoginForm } from '../components/TechnicianLoginForm.js';
import { TechnicianRequest } from '../components/TechnicianRequest.js';
import { TwoFactorSettings } from '../components/TwoFactorSettings.js';
import { api, ApiError } from '../lib/api.js';

interface QueueItem {
  id: string;
  session_code: string;
  platform: string;
  created_at: string;
  human_requested_at: string | null;
  duration_minutes: number;
  client_phone: string;
  client_name: string | null;
  company_name?: string | null;
  company_priority?: string | null;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.floor(hours / 24)} j`;
}

/** La console est installable sur l'écran d'accueil du téléphone : son propre manifeste la fait s'ouvrir sur /technicien. */
function useTechnicianManifest() {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previous = link?.getAttribute('href') ?? null;
    link?.setAttribute('href', '/technicien.webmanifest');
    return () => {
      if (link && previous) link.setAttribute('href', previous);
    };
  }, []);
}

export function TechnicianPage() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('tech_assist_token'));
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pendingOrders, setPendingOrders] = useState<TechOrder[]>([]);
  const [mySessions, setMySessions] = useState<MySession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const sessionParam = params.get('session');
  const openId = sessionParam && UUID.test(sessionParam) ? sessionParam : null;
  useTechnicianManifest();

  const refresh = useCallback(async () => {
    try {
      const [queueRes, ordersRes, mySessionsRes] = await Promise.all([
        api.get<{ queue: QueueItem[] }>('/api/technician/queue'),
        api.get<{ orders: TechOrder[] }>('/api/orders/pending-payment').catch(() => ({ orders: [] })),
        api.get<{ sessions: MySession[] }>('/api/technician/my-sessions'),
      ]);
      setQueue(queueRes.queue);
      setPendingOrders(ordersRes.orders);
      setMySessions(mySessionsRes.sessions);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        localStorage.removeItem('tech_assist_token');
        setToken(null);
      } else {
        setError("Impossible de charger la file d'attente.");
      }
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
  }, [token, refresh]);

  // Le nombre de demandes en attente apparaît dans l'onglet : on le voit même si la page est derrière une autre.
  useEffect(() => {
    const base = document.title;
    if (token && queue.length > 0) document.title = `(${queue.length}) Demande de technicien · Tech Assist`;
    return () => {
      document.title = base;
    };
  }, [token, queue.length]);

  function handleLoggedIn(newToken: string) {
    localStorage.setItem('tech_assist_token', newToken);
    setToken(newToken);
  }

  const logout = useCallback(() => {
    localStorage.removeItem('tech_assist_token');
    setToken(null);
  }, []);

  async function confirmPayment(orderId: string) {
    await api.post(`/api/orders/${orderId}/confirm-payment`);
    void refresh();
  }

  if (!token) {
    return (
      <div className="ta-container flex min-h-[70vh] max-w-md items-center py-14">
        <div className="ta-card w-full p-8">
          <p className="ta-eyebrow mb-2">Console technicien</p>
          <h1 className="mb-6 text-2xl font-bold">Espace technicien</h1>
          <TechnicianLoginForm onLoggedIn={handleLoggedIn} />
        </div>
      </div>
    );
  }

  if (openId) {
    return (
      <div className="ta-container max-w-3xl py-6 sm:py-10">
        <TechnicianRequest sessionId={openId} onBack={() => setParams({})} onUnauthorized={logout} onChanged={() => void refresh()} />
      </div>
    );
  }

  return (
    <div className="ta-container max-w-3xl space-y-8 py-6 sm:py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Console technicien</h1>
        <button onClick={logout} className="text-sm text-slate-500 hover:underline">
          Déconnexion
        </button>
      </div>

      <TechnicianAlerts />

      {error && <p className="text-red-600">{error}</p>}

      <section aria-label="Demandes de technicien">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          Demandes de technicien
          {queue.length > 0 && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-bold text-white">{queue.length}</span>}
        </h2>
        {queue.length === 0 && <p className="text-sm text-slate-500">Aucune demande en attente. Vous serez prévenu dès qu'un client en fera une.</p>}
        <ul className="space-y-2">
          {queue.map((s) => (
            <li key={s.id}>
              <Link
                to={`/technicien?session=${s.id}`}
                className={`block rounded-2xl border bg-white p-4 transition hover:border-brand-200 ${s.company_priority === 'urgent' ? 'border-brand-500' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words font-semibold">
                    {s.client_name ?? 'Client'}
                    {s.company_name && <span className="font-normal text-slate-500"> · {s.company_name}</span>}
                  </p>
                  <span className="shrink-0 text-sm font-semibold text-brand-700">{ago(s.human_requested_at ?? s.created_at)}</span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  {s.platform === 'android' ? 'Android' : 'Windows'} · code {s.session_code}
                  {s.company_priority === 'urgent' && <span className="ml-2 font-bold text-brand-700">Urgent</span>}
                </p>
                <span className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 text-sm font-bold text-white">Ouvrir le dossier</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Mes interventions">
        <h2 className="mb-3 font-semibold">Mes interventions en cours</h2>
        {mySessions.length === 0 && <p className="text-sm text-slate-500">Aucune intervention en cours.</p>}
        <ul className="space-y-2">
          {mySessions.map((s) => (
            <ActiveSessionCard key={s.id} session={s} />
          ))}
        </ul>
      </section>

      {pendingOrders.length > 0 && (
        <section aria-label="Paiements à confirmer">
          <h2 className="mb-3 font-semibold">Paiements en attente de confirmation</h2>
          <ul className="space-y-2">
            {pendingOrders.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="min-w-0">
                  <p className="font-medium">
                    {o.plan_name} — {o.amount_fcfa.toLocaleString('fr-FR')} FCFA
                  </p>
                  <p className="truncate text-sm text-slate-500">
                    {o.client_name ?? 'Client'} · {o.client_phone}
                  </p>
                </div>
                <button onClick={() => void confirmPayment(o.id)} className="shrink-0 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-brand-700">
                  Paiement reçu
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Sécurité du compte">
        <h2 className="mb-3 font-semibold">Sécurité du compte</h2>
        <TwoFactorSettings />
      </section>
    </div>
  );
}
