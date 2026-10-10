import { useEffect, useState } from 'react';
import { api, ApiError, type ViewerSession } from '../lib/api.js';

const METHOD_LABELS: Record<string, string> = { wave: 'Wave', orange: 'Orange Money', mtn: 'MTN MoMo', moov: 'Moov Money', djamo: 'Djamo' };

const STATE_TEXT: Record<ViewerSession['state'], { label: string; tone: string }> = {
  waiting_client: { label: 'En attente du client', tone: 'bg-slate-100 text-slate-700' },
  ready: { label: 'Prête : connectez-vous', tone: 'bg-brand-50 text-brand-700' },
  free: { label: 'Durée gratuite en cours', tone: 'bg-emerald-50 text-emerald-800' },
  payment_required: { label: 'Paiement requis', tone: 'bg-red-50 text-red-700' },
  paid: { label: 'Session payée', tone: 'bg-emerald-50 text-emerald-800' },
  ended: { label: 'Terminée', tone: 'bg-slate-100 text-slate-500' },
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface Credentials {
  remotePeerId: string;
  remotePassword: string;
}

/**
 * Une session viewer : le partenaire donne le code à son client, se connecte quand celui-ci a autorisé,
 * profite de 3 minutes gratuites puis règle la session (500 FCFA) pour continuer.
 */
export function ViewerSessionCard({ session, methods, priceFcfa, fetchedAt, onChanged }: { session: ViewerSession; methods: string[]; priceFcfa: number | null; fetchedAt: number; onChanged: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const elapsed = (now - fetchedAt) / 1000;
  const freeLeft = session.freeLeft !== null ? session.freeLeft - elapsed : null;
  const cutIn = session.cutIn !== null ? session.cutIn - elapsed : null;
  const text = STATE_TEXT[session.state];
  const active = session.state !== 'ended';
  const price = (priceFcfa ?? session.amountFcfa).toLocaleString('fr-FR');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur, réessayez.');
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  const connect = () =>
    run(async () => {
      setCredentials(await api.post<Credentials>(`/api/partner/viewer-sessions/${session.id}/connect`));
    });
  const stop = () =>
    run(async () => {
      await api.post(`/api/partner/viewer-sessions/${session.id}/stop`);
      setCredentials(null);
    });
  const pay = (method: string) =>
    run(async () => {
      const res = await api.post<{ url: string }>(`/api/partner/viewer-sessions/${session.id}/pay`, { method });
      window.location.href = res.url;
    });

  const clientLink = session.code ? `${window.location.origin}/session?code=${session.code}` : null;

  return (
    <li className="ta-card space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold">{session.label || 'Session sans nom'}</p>
          <p className="text-xs text-slate-500">{new Date(session.createdAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${text.tone}`}>{text.label}</span>
      </div>

      {session.state === 'waiting_client' && session.code && (
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="text-slate-600">Donnez ce code à votre client. Il l'ouvre, autorise le contrôle, puis vous pouvez vous connecter.</p>
          <p className="my-2 text-center font-mono text-2xl font-extrabold tracking-[0.25em]">{session.code}</p>
          {clientLink && (
            <button type="button" onClick={() => void navigator.clipboard?.writeText(clientLink)} className="w-full text-center text-xs font-semibold text-brand-700 hover:underline">
              Copier le lien à envoyer au client
            </button>
          )}
        </div>
      )}

      {session.state === 'free' && freeLeft !== null && (
        <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          Gratuit encore <span className="font-mono text-lg font-extrabold">{clock(freeLeft)}</span>. Pour ne pas être interrompu, payez la session ({price} FCFA) avant la fin.
        </p>
      )}
      {session.state === 'payment_required' && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">
          La durée gratuite est terminée. Sans paiement, la connexion est coupée dans <span className="font-mono text-lg font-extrabold">{clock(cutIn ?? 0)}</span>.
        </p>
      )}

      {credentials && active && (
        <div className="space-y-1 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm">
          <p className="font-semibold text-brand-800">Ouvrez RustDesk et connectez-vous avec :</p>
          <p>
            ID : <span className="font-mono font-bold">{credentials.remotePeerId}</span>
          </p>
          <p>
            Mot de passe : <span className="font-mono font-bold">{credentials.remotePassword}</span>
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {active && (
        <div className="flex flex-wrap gap-2">
          {['ready', 'free', 'paid'].includes(session.state) && (
            <button type="button" disabled={busy} onClick={() => void connect()} className="ta-button-primary disabled:opacity-60">
              {credentials ? 'Redonner les identifiants' : 'Me connecter'}
            </button>
          )}
          {session.state !== 'paid' && (
            <button type="button" disabled={busy} onClick={() => setPaying(!paying)} className="ta-button-secondary disabled:opacity-60">
              Payer {price} FCFA
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void stop()} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 sm:w-auto">
            Terminer
          </button>
        </div>
      )}

      {paying && active && session.state !== 'paid' && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          {methods.length === 0 ? (
            <p className="text-sm text-slate-600">Le paiement en ligne n'est pas disponible pour le moment : contactez l'équipe Tech Assist avec la référence de votre session.</p>
          ) : (
            <>
              <p className="text-sm font-semibold">Payer avec :</p>
              <div className="grid grid-cols-2 gap-2">
                {methods.map((m) => (
                  <button key={m} type="button" disabled={busy} onClick={() => void pay(m)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold hover:border-brand-200 disabled:opacity-60">
                    {METHOD_LABELS[m] ?? m}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
