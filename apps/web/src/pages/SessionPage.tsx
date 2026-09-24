import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RemotePairingPanel } from '../components/RemotePairingPanel.js';
import { api, ApiError, type SessionInfo } from '../lib/api.js';

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function SessionPage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [inputCode, setInputCode] = useState(params.get('code') ?? '');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async (sessionCode: string) => {
    try {
      const res = await api.get<{ session: SessionInfo }>(`/api/sessions/${sessionCode}`);
      setSession(res.session);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Session introuvable.');
      setSession(null);
    }
  }, []);

  useEffect(() => {
    if (!code) return;
    refresh(code);
    const interval = setInterval(() => refresh(code), 3000);
    return () => clearInterval(interval);
  }, [code, refresh]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  async function giveConsent(stage: 'screen' | 'control') {
    if (!session) return;
    await api.post(`/api/sessions/${session.id}/consent`, { stage });
    refresh(code);
  }

  async function stopSession() {
    if (!session) return;
    await api.post(`/api/sessions/${session.id}/stop`, { stoppedBy: 'client' });
    refresh(code);
  }

  if (!code) {
    return (
      <div className="ta-container flex min-h-[70vh] max-w-md items-center py-14">
        <div className="ta-card w-full p-8">
          <p className="ta-eyebrow mb-2">Ma session</p>
          <h1 className="mb-6 text-2xl font-bold">Rejoindre ma session</h1>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCode(inputCode.trim());
            }}
            className="space-y-4"
          >
            <input
              required
              placeholder="Code à 9 chiffres"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              className="ta-input text-center text-lg tracking-widest"
            />
            <button type="submit" className="ta-button-primary w-full">
              Rejoindre
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error) return <p className="ta-container max-w-md py-14 text-red-600">{error}</p>;
  if (!session) return <p className="ta-container max-w-md py-14 text-slate-500">Chargement…</p>;

  const remaining = session.ends_at ? new Date(session.ends_at).getTime() - now : null;
  const codeRemaining = new Date(session.code_expires_at).getTime() - now;

  return (
    <div className="ta-container max-w-xl py-14">
      <p className="ta-eyebrow mb-2">Ma session</p>
      <h1 className="mb-1 text-2xl font-bold sm:text-3xl">Session {session.session_code}</h1>
      <p className="mb-6 text-slate-500">Statut : {session.status}</p>

      {session.status === 'created' && (
        <p className="ta-card border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          En attente d'un technicien. Ce code expire dans {formatRemaining(codeRemaining)}.
        </p>
      )}

      {session.status === 'active' && remaining !== null && (
        <div className="ta-card p-6">
          <p className="text-sm text-slate-500">Temps restant</p>
          <p className="text-3xl font-bold text-brand-700">{formatRemaining(remaining)}</p>
          {remaining < 5 * 60 * 1000 && (
            <p className="mt-1 text-sm text-amber-700">Moins de 5 minutes restantes.</p>
          )}
        </div>
      )}

      {(session.status === 'created' || session.status === 'active') && (
        <div className="mt-6">
          <RemotePairingPanel
            sessionId={session.id}
            sessionCode={code}
            alreadyPaired={Boolean(session.remote_paired_at)}
            onPaired={() => refresh(code)}
          />
        </div>
      )}

      {session.status === 'active' && (
        <div className="mt-6 space-y-3">
          {!session.consent_screen_at && (
            <button
              onClick={() => giveConsent('screen')}
              className="w-full rounded-xl border border-brand-600 px-4 py-3 font-medium text-brand-700 transition hover:bg-brand-50"
            >
              J'autorise le partage d'écran
            </button>
          )}
          {session.consent_screen_at && !session.consent_control_at && (
            <button
              onClick={() => giveConsent('control')}
              className="w-full rounded-xl border border-brand-600 px-4 py-3 font-medium text-brand-700 transition hover:bg-brand-50"
            >
              J'autorise le technicien à prendre le contrôle
            </button>
          )}
          {session.consent_control_at && (
            <p className="rounded-xl bg-green-50 p-3 text-sm text-green-800">
              Partage d'écran et contrôle autorisés.
            </p>
          )}
        </div>
      )}

      {(session.status === 'created' || session.status === 'active' || session.status === 'waiting_technician') && (
        <button
          onClick={stopSession}
          className="mt-8 w-full rounded-xl bg-red-600 px-4 py-3 font-medium text-white transition hover:bg-red-700"
        >
          Arrêter la session maintenant
        </button>
      )}

      {session.status === 'completed' && (
        <p className="ta-card p-4 text-slate-600">
          Cette session est terminée. Merci d'avoir utilisé Tech Assist.
        </p>
      )}
    </div>
  );
}
