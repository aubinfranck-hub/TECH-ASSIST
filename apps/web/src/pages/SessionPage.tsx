import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
      <div className="mx-auto max-w-md px-4 py-14">
        <h1 className="text-2xl font-bold mb-4">Rejoindre ma session</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCode(inputCode.trim());
          }}
          className="space-y-3"
        >
          <input
            required
            placeholder="Code à 9 chiffres"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-center text-lg tracking-widest"
          />
          <button type="submit" className="w-full rounded-lg bg-brand-600 px-4 py-3 text-white font-medium hover:bg-brand-700">
            Rejoindre
          </button>
        </form>
      </div>
    );
  }

  if (error) return <p className="mx-auto max-w-md px-4 py-14 text-red-600">{error}</p>;
  if (!session) return <p className="mx-auto max-w-md px-4 py-14 text-slate-500">Chargement…</p>;

  const remaining = session.ends_at ? new Date(session.ends_at).getTime() - now : null;
  const codeRemaining = new Date(session.code_expires_at).getTime() - now;

  return (
    <div className="mx-auto max-w-xl px-4 py-14">
      <h1 className="text-2xl font-bold mb-1">Session {session.session_code}</h1>
      <p className="text-slate-500 mb-6">Statut : {session.status}</p>

      {session.status === 'created' && (
        <p className="rounded-lg bg-amber-50 p-4 text-amber-800 text-sm">
          En attente d'un technicien. Ce code expire dans {formatRemaining(codeRemaining)}.
        </p>
      )}

      {session.status === 'active' && remaining !== null && (
        <div className="rounded-lg border bg-white p-5">
          <p className="text-sm text-slate-500">Temps restant</p>
          <p className="text-3xl font-bold text-brand-700">{formatRemaining(remaining)}</p>
          {remaining < 5 * 60 * 1000 && (
            <p className="mt-1 text-sm text-amber-700">Moins de 5 minutes restantes.</p>
          )}
        </div>
      )}

      {session.status === 'active' && (
        <div className="mt-6 space-y-3">
          {!session.consent_screen_at && (
            <button
              onClick={() => giveConsent('screen')}
              className="w-full rounded-lg border border-brand-600 text-brand-700 px-4 py-3 font-medium hover:bg-brand-50"
            >
              J'autorise le partage d'écran
            </button>
          )}
          {session.consent_screen_at && !session.consent_control_at && (
            <button
              onClick={() => giveConsent('control')}
              className="w-full rounded-lg border border-brand-600 text-brand-700 px-4 py-3 font-medium hover:bg-brand-50"
            >
              J'autorise le technicien à prendre le contrôle
            </button>
          )}
          {session.consent_control_at && (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
              Partage d'écran et contrôle autorisés.
            </p>
          )}
        </div>
      )}

      {(session.status === 'created' || session.status === 'active' || session.status === 'waiting_technician') && (
        <button
          onClick={stopSession}
          className="mt-8 w-full rounded-lg bg-red-600 px-4 py-3 text-white font-medium hover:bg-red-700"
        >
          Arrêter la session maintenant
        </button>
      )}

      {session.status === 'completed' && (
        <p className="rounded-lg bg-slate-100 p-4 text-slate-600">
          Cette session est terminée. Merci d'avoir utilisé Tech Assist.
        </p>
      )}
    </div>
  );
}
