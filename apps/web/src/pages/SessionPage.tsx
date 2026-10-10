import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RemotePairingPanel } from '../components/RemotePairingPanel.js';
import { MicButton, ScreenShotButton, SpeakButton, speak, stopSpeaking, useTtsAvailable, type CapturedImage } from '../components/VoiceTools.js';
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
  const [lastProcedureId, setLastProcedureId] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const ttsAvailable = useTtsAvailable();
  const [autoRead, setAutoRead] = useState(() => {
    try { return localStorage.getItem('ta_autoread') === '1'; } catch { return false; }
  });
  const [pendingImage, setPendingImage] = useState<CapturedImage | null>(null);
  const lastSpokenId = useRef<number | null>(null);

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

  useEffect(() => {
    if (!session) return;
    void refreshMessages(session);
  }, [session, refreshMessages]);

  useEffect(() => {
    if (!session || session.mode !== 'ia' || initialAiStarted) return;
    const first = messages.find((m) => m.sender === 'client')?.body;
    if (!first) return;
    setInitialAiStarted(true);
    setChatLoading(true);
    void api.post<{ answer: string; model: string; procedureId?: string }>('/api/sessions/' + session.id + '/chat', { sessionCode: session.session_code, message: first, initial: true })
      .then((response) => { if (response.procedureId) setLastProcedureId(response.procedureId); return refreshMessages(session); })
      .catch((err) => setChatError(err instanceof ApiError ? err.message : "L'assistant IA est indisponible."))
      .finally(() => setChatLoading(false));
  }, [session, messages, initialAiStarted]);



  async function sendTechnicianMessage(message: string) {
    if (!session || session.mode !== 'humain' || !message.trim()) return;
    setChatLoading(true);
    setChatError(null);
    try {
      await api.post(`/api/sessions/${session.id}/messages`, {
        sessionCode: session.session_code,
        message: message.trim(),
      });
      setChatMessage('');
      await refreshMessages(session);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : 'Impossible d’envoyer votre message.');
    } finally {
      setChatLoading(false);
    }
  }

  // Lecture automatique : seules les NOUVELLES réponses de l'IA sont lues (pas l'historique à l'ouverture de la page).
  useEffect(() => {
    const assistant = messages.filter((m) => m.sender === 'assistant');
    const lastId = assistant.length ? assistant[assistant.length - 1]!.id : null;
    if (lastSpokenId.current === null) {
      lastSpokenId.current = lastId ?? 0;
      return;
    }
    if (lastId !== null && lastId > lastSpokenId.current) {
      lastSpokenId.current = lastId;
      if (autoRead && session) void speak(session.id, session.session_code, assistant[assistant.length - 1]!.body).catch(() => undefined);
    }
  }, [messages, autoRead, session]);

  useEffect(() => () => stopSpeaking(), []);

  function toggleAutoRead() {
    const next = !autoRead;
    setAutoRead(next);
    if (!next) stopSpeaking();
    try { localStorage.setItem('ta_autoread', next ? '1' : '0'); } catch { /* préférence facultative */ }
  }

  async function sendChat(message: string) {
    if (!session || session.mode !== 'ia' || !message.trim()) return;
    setChatLoading(true);
    setChatError(null);
    try {
      const response = await api.post<{ answer: string; model: string; procedureId?: string }>(`/api/sessions/${session.id}/chat`, {
        sessionCode: session.session_code,
        message: message.trim(),
        ...(pendingImage ? { image: pendingImage } : {}),
      });
      setPendingImage(null);
      if (response.procedureId) setLastProcedureId(response.procedureId);
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
              inputMode="numeric"
              pattern="[0-9]{9}"
              maxLength={9}
              placeholder="Code à 9 chiffres"
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value.replace(/\D/g, '').slice(0, 9))}
              className="ta-input text-center text-lg tracking-[0.35em]"
            />
            <p className="text-xs text-slate-500">Le code vous est communiqué lorsque votre demande crée une session. Si vous venez de lancer une assistance, vous avez déjà été redirigé automatiquement.</p>
            <button type="submit" className="ta-button-primary w-full">
              Rejoindre
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ta-container max-w-2xl py-12 sm:py-16">
        <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-card">
          <div className="bg-[#07101d] px-6 py-10 text-white sm:px-10">
            <p className="text-xs font-extrabold uppercase tracking-[.16em] text-slate-400">Ma session</p>
            <div className="mt-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl">?</div>
            <h1 className="mt-5 font-display text-3xl font-black sm:text-4xl">Cette session n’est plus disponible.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
              Le code <strong className="text-white">{code}</strong> est peut-être expiré, déjà terminé ou incorrect.
              Pas d’inquiétude : vous pouvez reprendre votre parcours depuis l’un des espaces TechAssist.
            </p>
          </div>
          <div className="p-6 sm:p-8">
            <p className="text-sm font-bold text-slate-500">Que souhaitez-vous faire ?</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <a href="/demander-aide" className="group rounded-2xl border border-brand-200 bg-brand-50 p-5 transition hover:border-brand-400 hover:shadow-md">
                <span className="text-2xl">🆘</span>
                <h2 className="mt-3 font-black text-slate-950">Demander de l’aide</h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">Créer une nouvelle demande d’assistance.</p>
                <span className="mt-3 inline-block text-sm font-bold text-brand-700">Commencer →</span>
              </a>
              <a href="/assistance" className="group rounded-2xl border border-slate-200 p-5 transition hover:border-brand-200 hover:shadow-md">
                <span className="text-2xl">💡</span>
                <h2 className="mt-3 font-black text-slate-950">Comment ça marche ?</h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">Découvrir le parcours IA → technicien.</p>
                <span className="mt-3 inline-block text-sm font-bold text-brand-700">Découvrir →</span>
              </a>
              <a href="/telephone" className="group rounded-2xl border border-slate-200 p-5 transition hover:border-brand-200 hover:shadow-md">
                <span className="text-2xl">📱</span>
                <h2 className="mt-3 font-black text-slate-950">Application Android</h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">Accéder à l’espace de l’application mobile.</p>
                <span className="mt-3 inline-block text-sm font-bold text-brand-700">Voir Android →</span>
              </a>
              <a href="/entreprise" className="group rounded-2xl border border-slate-200 p-5 transition hover:border-brand-200 hover:shadow-md">
                <span className="text-2xl">🏢</span>
                <h2 className="mt-3 font-black text-slate-950">Espace entreprise</h2>
                <p className="mt-1 text-sm leading-5 text-slate-600">Gérer les demandes et le parc informatique.</p>
                <span className="mt-3 inline-block text-sm font-bold text-brand-700">Accéder →</span>
              </a>
            </div>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
              <a href="/" className="ta-button-secondary">← Retour à l’accueil</a>
              <a href="/technicien" className="inline-flex items-center rounded-xl px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50">Espace technicien</a>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!session) return <p className="ta-container max-w-md py-14 text-slate-500">Chargement…</p>;

  const remaining = session.ends_at ? new Date(session.ends_at).getTime() - now : null;
  const statusLabel: Record<string, string> = {
    created: 'Demande reçue',
    waiting_technician: 'En attente d’un technicien',
    active: session.mode === 'ia' ? 'Conversation avec l’IA' : 'Assistance en cours',
    completed: 'Terminée',
    cancelled: 'Arrêtée',
  };

  return (
    <div className="ta-container max-w-xl py-14">
      <p className="ta-eyebrow mb-2">Ma demande d’aide</p>
      <h1 className="mb-2 text-2xl font-bold sm:text-3xl">{statusLabel[session.status] ?? session.status}</h1>
      <p className="mb-5 text-sm text-slate-500">
        Dossier n° <strong className="font-mono text-slate-800">{session.session_code}</strong> — notez-le pour retrouver cette page si vous la fermez.
      </p>

      {session.mode === 'humain' && ['created', 'waiting_technician', 'active'].includes(session.status) && (
        <ol className="mb-5 space-y-2 text-sm">
          {([
            [session.remote_paired_at ? 'Votre ordinateur est prêt.' : 'Cliquez sur « Préparer mon ordinateur » ci-dessous, puis ouvrez le fichier téléchargé.', !!session.remote_paired_at],
            [session.technician_id ? 'Un technicien est là. Quand il se connecte, cliquez sur « Accepter » dans la fenêtre RustDesk.' : 'Un technicien va vous répondre ici. Quand il se connecte, cliquez sur « Accepter » dans la fenêtre RustDesk.', false],
          ] as const).map(([text, done], i) => (
            <li key={i} className={`flex gap-3 rounded-xl border p-3 ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-700'}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{done ? '✓' : i + 1}</span>
              <span>{text}</span>
            </li>
          ))}
        </ol>
      )}

      {session.requested_mode === 'ia' && session.mode === 'humain' && session.status !== 'completed' && (
        <p className="ta-card mb-4 border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          L'agent IA n'est pas encore disponible : un technicien prend votre demande en charge.
        </p>
      )}

      {session.mode === 'ia' && (session.status === 'created' || session.status === 'active') && (
        <div className="ta-card mb-4 border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
          <p className="font-bold">Votre agent IA vous assiste</p>
          <p className="mt-1 leading-6">
            Il vous guide étape par étape. Il ne prétend pas avoir réparé votre appareil et vous pouvez passer à un technicien à tout moment.
          </p>
          <button onClick={escalateToHuman} className="mt-3 font-semibold text-brand-700 underline">
            Passer à un technicien
          </button>
        </div>
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
              Je vous conseille par écrit. <strong>Je ne vois pas votre ordinateur</strong> et je ne peux rien y modifier depuis cette page. Pour que votre PC soit analysé et réparé avec votre accord, utilisez l’<a href="https://github.com/aubinfranck-hub/TECH-ASSIST/releases/download/agent-latest/tech-assist-agent.exe" className="font-semibold text-brand-700 underline">agent Windows</a> ; sinon, demandez un technicien.
            </p>
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
            {messages.filter((m) => m.sender === 'client' || m.sender === 'assistant' || m.sender === 'system').map((m) => (
              <div key={m.id} className={`rounded-xl p-3 text-sm ${m.sender === 'client' ? 'ml-8 bg-brand-50 text-brand-950' : 'mr-8 bg-white text-slate-700'}`}>
                <p className="mb-1 text-xs font-semibold text-slate-400">{m.sender === 'client' ? 'Vous' : m.sender === 'assistant' ? 'TechAssist IA' : 'TechAssist'}</p>
                <p className="whitespace-pre-wrap leading-6">{m.body}</p>
                {m.sender === 'assistant' && ttsAvailable && <SpeakButton sessionId={session.id} sessionCode={session.session_code} text={m.body} />}
              </div>
            ))}
            {messages.filter((m) => m.sender === 'client' || m.sender === 'assistant').length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">{chatLoading ? '🤖 L’IA rédige sa réponse…' : 'Écrivez votre question ci-dessous : l’IA vous répondra par écrit.'}</p>
            )}
          </div>
          {chatError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{chatError}</p>}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-800">Cette piste a-t-elle résolu votre problème ?</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <button disabled={feedbackLoading} onClick={async () => { setFeedbackLoading(true); try { await api.post('/api/sessions/' + session.id + '/ai-feedback', { sessionCode: session.session_code, procedureId: lastProcedureId ?? undefined, result: 'resolved' }); await refreshMessages(session); } finally { setFeedbackLoading(false); } }} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">✓ Oui, c’est résolu</button>
              <button disabled={feedbackLoading} onClick={async () => { setFeedbackLoading(true); try { const r = await api.post<{ status: string; procedureId?: string }>('/api/sessions/' + session.id + '/ai-feedback', { sessionCode: session.session_code, procedureId: lastProcedureId ?? undefined, result: 'not_resolved' }); if (r.procedureId) setLastProcedureId(r.procedureId); await refresh(code); await refreshMessages(session); } finally { setFeedbackLoading(false); } }} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 disabled:opacity-50">✕ Non, j’ai toujours le problème</button>
            </div>
          </div>
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
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <MicButton disabled={chatLoading} onText={(t) => void sendChat(t)} />
            <ScreenShotButton disabled={chatLoading} onCapture={setPendingImage} />
            {ttsAvailable && (
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={autoRead} onChange={toggleAutoRead} /> 🔊 Lire les réponses
              </label>
            )}
          </div>
          {pendingImage && (
            <p className="mt-2 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-900">
              📷 Capture de votre écran jointe à votre prochain message (elle n’est pas conservée).
              <button type="button" onClick={() => setPendingImage(null)} className="font-bold underline">Retirer</button>
            </p>
          )}
        </div>
      )}

      {session.mode === 'humain' && (session.status === 'created' || session.status === 'waiting_technician' || session.status === 'active') && (
        <div className="ta-card mt-6 p-5">
          <div className="mb-4">
            <p className="font-bold text-slate-900">💬 Échange avec le technicien</p>
            <p className="mt-1 text-sm text-slate-500">
              {session.technician_id ? 'Le technicien voit l’historique de votre dossier et vos messages.' : 'Vous pouvez déjà ajouter une précision pendant l’attente.'}
            </p>
          </div>
          <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3">
            {messages.filter((m) => m.sender === 'client' || m.sender === 'technician' || m.sender === 'system').map((m) => (
              <div key={m.id} className={`rounded-xl p-3 text-sm ${m.sender === 'client' ? 'ml-8 bg-brand-50 text-brand-950' : 'mr-8 bg-white text-slate-700'}`}>
                <p className="mb-1 text-xs font-semibold text-slate-400">{m.sender === 'client' ? 'Vous' : m.sender === 'technician' ? 'Technicien Tech Assist' : 'Tech Assist'}</p>
                <p className="whitespace-pre-wrap leading-6">{m.body}</p>
              </div>
            ))}
            {messages.filter((m) => m.sender === 'client' || m.sender === 'technician').length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">Votre dossier est prêt. Le technicien pourra vous répondre ici.</p>
            )}
          </div>
          {chatError && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{chatError}</p>}
          <form onSubmit={(e) => { e.preventDefault(); void sendTechnicianMessage(chatMessage); }} className="mt-4 flex gap-2">
            <input
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              disabled={chatLoading}
              placeholder="Écrire au technicien…"
              className="ta-input flex-1"
            />
            <button disabled={chatLoading || !chatMessage.trim()} className="ta-button-primary px-5">
              {chatLoading ? '…' : 'Envoyer'}
            </button>
          </form>
        </div>
      )}

      {['created', 'waiting_technician', 'active'].includes(session.status) && session.mode === 'humain' && (
        <div className="mt-6">
          <RemotePairingPanel
            sessionId={session.id}
            sessionCode={code}
            alreadyPaired={Boolean(session.remote_paired_at)}
            onPaired={() => refresh(code)}
          />
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
        <div className="ta-card p-5 text-slate-700">
          <p className="font-bold">Votre assistance est terminée.</p>
          <p className="mt-1 text-sm leading-6">Merci d’avoir utilisé Tech Assist. Si le problème revient, vous pouvez ouvrir une nouvelle demande depuis le site.</p>
          <a href="/demander-aide" className="mt-4 inline-flex font-bold text-brand-700 hover:underline">Ouvrir une nouvelle demande →</a>
        </div>
      )}
    </div>
  );
}
