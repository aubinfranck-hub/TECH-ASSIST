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
  const [messages, setMessages] = useState<{ id: number; sender: string; body: string; at: string }[]>([]);
  const [chatMessage, setChatMessage] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [initialAiStarted, setInitialAiStarted] = useState(false);

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

  const refreshMessages = useCallback(async (current: SessionInfo) => {
    try {
      const res = await api.get<{ messages: { id: number; sender: string; body: string; at: string }[] }>(
        `/api/sessions/${current.id}/messages?sessionCode=${encodeURIComponent(current.session_code)}`,
      );
      setMessages(res.messages);
      return res.messages;
    } catch {
      return [];
    }
  }, []);

  async function sendChat(message: string) {
    if (!session || session.mode !== 'ia' || !message.trim()) return;
    setChatLoading(true);
    setChatError(null);
    try {
      await api.post<{ answer: string; model: string }>(`/api/sessions/${session.id}/chat`, {
        sessionCode: session.session_code,
        message: message.trim(),
      });
      setChatMessage('');
      await refreshMessages(session);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : "L'assistant IA est indisponible.");
      await refreshMessages(session);
    } finally {
      setChatLoading(false);
    }
  }

  async function giveConsent(stage: 'screen' | 'control') {
    if (!session) return;
    await api.post(`/api/sessions/${session.id}/consent`, { stage, sessionCode: session.session_code });
    refresh(code);
  }

  async function escalateToHuman() {
    if (!session) return;
    await api.post(`/api/sessions/${session.id}/escalate`, { sessionCode: session.session_code });
    refresh(code);
  }

  async function stopSession() {
    if (!session) return;
    await api.post(`/api/sessions/${session.id}/stop`, { stoppedBy: 'client', sessionCode: session.session_code });
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

      {session.requested_mode === 'ia' && session.mode === 'humain' && session.status !== 'completed' && (
        <p className="ta-card mb-4 border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          L'agent IA n'est pas encore disponible : un technicien prend votre demande en charge.
        </p>
      )}

      {session.mode === 'ia' && (session.status === 'created' || session.status === 'active') && (
        <div className="ta-card mb-4 border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
          <p className="font-bold">Votre agent IA vous assiste</p>
          <p className="mt-1 leading-6">
            Il n'agit sur votre appareil qu'avec votre accord, et vous pouvez tout arrêter à tout moment.
          </p>
          <button onClick={escalateToHuman} className="mt-3 font-semibold text-brand-700 underline">
            Passer à un technicien
          </button>
        </div>
      )}

      {session.status === 'created' && session.mode !== 'ia' && (
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

      {session.mode === 'ia' && (session.status === 'created' || session.status === 'active') && (
        <div className="ta-card mt-6 p-5">
          <div className="mb-4">
            <p className="font-bold text-slate-900">🤖 Assistant IA TechAssist</p>
            <p className="mt-1 text-sm text-slate-500">
              J'analyse votre problème. Si je ne peux pas le résoudre, je passe la main à un technicien.
            </p>
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
            {messages.filter((m) => m.sender === 'client' || m.sender === 'assistant' || m.sender === 'system').map((m) => (
              <div key={m.id} className={`rounded-xl p-3 text-sm ${m.sender === 'client' ? 'ml-8 bg-brand-50 text-brand-950' : 'mr-8 bg-white text-slate-700'}`}>
                <p className="mb-1 text-xs font-semibold text-slate-400">{m.sender === 'client' ? 'Vous' : m.sender === 'assistant' ? 'TechAssist IA' : 'TechAssist'}</p>
                <p className="whitespace-pre-wrap leading-6">{m.body}</p>
              </div>
            ))}
            {messages.filter((m) => m.sender === 'client' || m.sender === 'assistant').length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">Analyse en cours…</p>
            )}
          </div>
          {chatError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{chatError}</p>}
          <form onSubmit={(e) => { e.preventDefault(); void sendChat(chatMessage); }} className="mt-4 flex gap-2">
            <input
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              disabled={chatLoading}
              placeholder="Décrivez ce qui se passe ou répondez à l'IA…"
              className="ta-input flex-1"
            />
            <button disabled={chatLoading || !chatMessage.trim()} className="ta-button-primary px-5">
              {chatLoading ? '…' : 'Envoyer'}
            </button>
          </form>
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
