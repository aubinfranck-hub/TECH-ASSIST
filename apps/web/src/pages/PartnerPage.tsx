import { useCallback, useEffect, useRef, useState } from 'react';
import { PartnerRegisterForm } from '../components/PartnerRegisterForm.js';
import { TechnicianLoginForm } from '../components/TechnicianLoginForm.js';
import { TwoFactorSettings } from '../components/TwoFactorSettings.js';
import { ViewerSessionCard } from '../components/ViewerSessionCard.js';
import { api, ApiError, type PartnerOffer, type ViewerSession } from '../lib/api.js';

interface PartnerMe {
  partner: { id: string; fullName: string; username: string; businessName: string | null; totpEnabled: boolean };
  offer: PartnerOffer;
}

/** Espace des techniciens partenaires : se connecter au poste de ses propres clients par Tech Assist. */
export function PartnerPage() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('tech_assist_token'));
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [sessions, setSessions] = useState<ViewerSession[]>([]);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem('tech_assist_token');
    setToken(null);
    setMe(null);
    setSessions([]);
    setBlocked(null);
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get<PartnerMe>('/api/partner/me'));
      setBlocked(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) logout();
      else if (err instanceof ApiError && err.status === 403) setBlocked("Ce compte n'est pas un compte partenaire actif.");
      else setError('Impossible de charger votre espace.');
    }
  }, [logout]);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await api.get<{ sessions: ViewerSession[] }>('/api/partner/viewer-sessions');
      setSessions(res.sessions);
      setFetchedAt(Date.now());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) logout();
    }
  }, [logout]);

  useEffect(() => {
    if (token) void loadMe();
  }, [token, loadMe]);

  // Les sessions se relisent régulièrement : le client qui autorise, le paiement confirmé et la coupure arrivent d'eux-mêmes.
  const hasOpen = sessions.some((s) => s.state !== 'ended');
  useEffect(() => {
    if (!token || !me) return;
    void refreshSessions();
    timer.current = setInterval(() => void refreshSessions(), hasOpen ? 4000 : 20000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [token, me, hasOpen, refreshSessions]);

  async function openSession(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/partner/viewer-sessions', { label: label || undefined });
      setLabel('');
      await refreshSessions();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’ouvrir la session.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="ta-container flex min-h-[70vh] max-w-md items-center py-14">
        <div className="ta-card w-full p-8">
          <p className="ta-eyebrow mb-2">Techniciens partenaires</p>
          <h1 className="mb-2 text-2xl font-bold">Dépannez vos clients à distance</h1>
          <p className="mb-5 text-sm text-slate-600">Connectez-vous au poste de vos clients par Tech Assist. La tarification partenaire est affichée dans votre espace selon l’offre active.</p>
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
            <button type="button" onClick={() => setTab('login')} className={`rounded-lg py-2 ${tab === 'login' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>
              Se connecter
            </button>
            <button type="button" onClick={() => setTab('register')} className={`rounded-lg py-2 ${tab === 'register' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>
              Créer un compte
            </button>
          </div>
          {tab === 'login' ? (
            <TechnicianLoginForm
              onLoggedIn={(t) => {
                localStorage.setItem('tech_assist_token', t);
                setToken(t);
              }}
            />
          ) : (
            <PartnerRegisterForm />
          )}
        </div>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="ta-container max-w-md py-14">
        <div className="ta-card space-y-3 p-6">
          <p className="text-sm text-slate-700">{blocked}</p>
          <button onClick={logout} className="ta-button-secondary w-full">
            Changer de compte
          </button>
        </div>
      </div>
    );
  }

  const price = me?.offer.priceFcfa;
  return (
    <div className="ta-container max-w-3xl space-y-8 py-6 sm:py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="ta-eyebrow">Espace partenaire</p>
          <h1 className="truncate text-2xl font-bold">{me?.partner.businessName || me?.partner.fullName || 'Mon espace'}</h1>
        </div>
        <button onClick={logout} className="shrink-0 text-sm text-slate-500 hover:underline">
          Déconnexion
        </button>
      </div>

      {me && !me.partner.totpEnabled && (
        <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">Une étape avant de vous connecter chez vos clients : activez la double authentification.</p>
          <p className="text-sm text-amber-900">Vous allez accéder à des ordinateurs qui ne sont pas les vôtres : nous protégeons votre compte par un code en plus du mot de passe.</p>
          <TwoFactorSettings onEnabled={() => void loadMe()} />
        </section>
      )}

      {me?.partner.totpEnabled && (
        <section aria-label="Nouvelle session" className="ta-card space-y-3 p-5">
          <h2 className="font-semibold">Nouvelle session</h2>
          <p className="text-sm text-slate-600">
            Offre partenaire active : {Math.round((me.offer.freeSeconds ?? 180) / 60)} minutes incluses à la connexion, puis {price !== null && price !== undefined ? `${price.toLocaleString('fr-FR')} FCFA` : 'un tarif fixe'} la session.
          </p>
          <form onSubmit={openSession} className="flex flex-col gap-2 sm:flex-row">
            <input placeholder="Nom du client (facultatif)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} className="ta-input flex-1" />
            <button type="submit" disabled={busy} className="ta-button-primary disabled:opacity-60">
              Ouvrir une session
            </button>
          </form>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>
      )}

      <section aria-label="Mes sessions">
        <h2 className="mb-3 font-semibold">Mes sessions</h2>
        {sessions.length === 0 && <p className="text-sm text-slate-500">Aucune session pour le moment.</p>}
        <ul className="space-y-3">
          {sessions.map((s) => (
            <ViewerSessionCard key={s.id} session={s} methods={me?.offer.methods ?? []} priceFcfa={price ?? null} fetchedAt={fetchedAt} onChanged={() => void refreshSessions()} />
          ))}
        </ul>
      </section>

      {me?.partner.totpEnabled && (
        <section aria-label="Sécurité du compte">
          <h2 className="mb-3 font-semibold">Sécurité du compte</h2>
          <p className="rounded-xl border bg-white p-4 text-sm text-emerald-700">Double authentification activée ✓ — un code est demandé à chaque connexion.</p>
        </section>
      )}
    </div>
  );
}
