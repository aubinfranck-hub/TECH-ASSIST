import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import type { Progress } from '../lib/taskProgress.js';
import { RemoteAccess } from './ActiveSessionCard.js';
import { TaskProgressCard } from './TaskProgressCard.js';

interface Message {
  id: number;
  sender: 'client' | 'technician' | 'system';
  body: string;
  at: string;
  name: string | null;
}

interface Entry {
  at: string;
  kind: 'client' | 'agent' | 'technician' | 'system';
  text: string;
}

interface Detail {
  session: {
    id: string;
    code: string;
    status: string;
    platform: string;
    mode: string;
    createdAt: string;
    requestedAt: string | null;
    startedAt: string | null;
    endsAt: string | null;
    technician: string | null;
    mine: boolean;
    canWrite: boolean;
    consentScreen: boolean;
    consentControl: boolean;
  };
  client: { name: string | null; phone: string; email: string | null };
  progress: Progress | null;
  timeline: Entry[];
  messages: Message[];
}

interface MessagesPoll {
  status: string;
  canWrite: boolean;
  progress: Progress | null;
  messages: Message[];
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
/** Numéro pour WhatsApp : chiffres seuls, indicatif de la Côte d'Ivoire ajouté aux numéros locaux à 10 chiffres. */
const waNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '').replace(/^00/, '');
  return digits.length === 10 ? `225${digits}` : digits;
};
const platformName = (p: string) => (p === 'android' ? 'Android' : p === 'windows' ? 'Windows' : 'Web');
const STATUS: Record<string, string> = {
  created: 'En attente',
  waiting_technician: 'En attente',
  active: 'En cours',
  completed: 'Terminée',
  expired: 'Expirée',
  cancelled: 'Annulée',
};
const KIND_STYLE: Record<Entry['kind'], string> = {
  client: 'bg-sky-500',
  agent: 'bg-brand-600',
  technician: 'bg-emerald-500',
  system: 'bg-slate-400',
};
const KIND_LABEL: Record<Entry['kind'], string> = { client: 'Client', agent: 'Agent', technician: 'Technicien', system: 'Système' };

const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Dossier d'une demande : ce que le client a dit, ce que l'agent a constaté et fait, discussion, prise en charge, fin. */
export function TechnicianRequest({ sessionId, onBack, onUnauthorized, onChanged }: { sessionId: string; onBack: () => void; onUnauthorized: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [showAll, setShowAll] = useState(false);
  /** Avancement des tâches de l'agent, avec l'instant de réception (le chronomètre avance entre deux relevés). */
  const [progress, setProgress] = useState<{ data: Progress; at: number } | null>(null);
  const lastId = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  const fail = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return onUnauthorized();
      setError(message(err));
    },
    [onUnauthorized],
  );

  const load = useCallback(async () => {
    try {
      const d = await api.get<Detail>(`/api/technician/sessions/${sessionId}`);
      setDetail(d);
      setProgress(d.progress ? { data: d.progress, at: Date.now() } : null);
      setMessages(d.messages);
      lastId.current = d.messages.at(-1)?.id ?? 0;
      setError(null);
    } catch (err) {
      fail(err);
    }
  }, [sessionId, fail]);

  const poll = useCallback(async () => {
    try {
      const res = await api.get<MessagesPoll>(`/api/technician/sessions/${sessionId}/messages?after=${lastId.current}`);
      if (res.messages.length > 0) {
        lastId.current = res.messages.at(-1)!.id;
        setMessages((m) => [...m, ...res.messages.filter((x) => !m.some((y) => y.id === x.id))]);
      }
      setDetail((d) => (d ? { ...d, session: { ...d.session, status: res.status, canWrite: res.canWrite } } : d));
      setProgress(res.progress ? { data: res.progress, at: Date.now() } : null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
    }
  }, [sessionId, onUnauthorized]);

  useEffect(() => {
    void load();
    const messagesTimer = setInterval(() => void poll(), 3000);
    const detailTimer = setInterval(() => void load(), 15000);
    return () => {
      clearInterval(messagesTimer);
      clearInterval(detailTimer);
    };
  }, [load, poll]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function act(label: string, work: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await work();
      await load();
      onChanged();
    } catch (err) {
      fail(err);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const claim = () => act('claim', () => api.patch(`/api/technician/sessions/${sessionId}/claim`));
  const finish = () =>
    act('finish', async () => {
      await api.post(`/api/technician/sessions/${sessionId}/finish`);
      setConfirmFinish(false);
    });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || busy) return;
    setBusy('send');
    setError(null);
    try {
      await api.post(`/api/technician/sessions/${sessionId}/messages`, { body });
      setDraft('');
      await poll();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  if (!detail) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="text-sm font-semibold text-brand-700">← Retour à la liste</button>
        <p className={`text-sm ${error ? 'text-red-600' : 'text-slate-500'}`}>{error ?? 'Chargement du dossier…'}</p>
      </div>
    );
  }

  const { session, client } = detail;
  const open = ['created', 'waiting_technician', 'active'].includes(session.status);
  const free = open && !session.technician;
  const timeline = showAll ? detail.timeline : detail.timeline.slice(-12);
  const hidden = detail.timeline.length - timeline.length;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm font-semibold text-brand-700">← Retour à la liste</button>

      <section className="ta-card space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{client.name ?? 'Client'}</h2>
            <p className="text-sm text-slate-500">
              Code {session.code} · {platformName(session.platform)}
              {session.requestedAt && ` · demandé à ${hhmm(session.requestedAt)}`}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${session.status === 'active' ? 'bg-emerald-50 text-emerald-700' : open ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
            {STATUS[session.status] ?? session.status}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <a href={`tel:${client.phone}`} className="ta-button-secondary !w-auto !py-2">Appeler {client.phone}</a>
          {client.phone && (
            <a href={`https://wa.me/${waNumber(client.phone)}`} target="_blank" rel="noreferrer" className="ta-button-secondary !w-auto !py-2">
              WhatsApp
            </a>
          )}
        </div>
        {client.email && <p className="break-all text-sm text-slate-500">{client.email}</p>}

        {free && (
          <button onClick={claim} disabled={busy === 'claim'} className="ta-button-primary disabled:opacity-60">
            {busy === 'claim' ? 'Prise en charge…' : 'Prendre en charge'}
          </button>
        )}
        {open && session.technician && !session.mine && <p className="text-sm text-amber-800">Cette demande est suivie par {session.technician}.</p>}
        {session.mine && open && (
          <div className="space-y-3">
            <RemoteAccess sessionId={session.id} controlGranted={session.consentControl} android={session.platform === 'android'} />
            {!confirmFinish ? (
              <button onClick={() => setConfirmFinish(true)} className="text-sm font-semibold text-slate-600 underline">
                Terminer l'assistance
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                <span>Le client sera prévenu et l'accès à distance coupé.</span>
                <button onClick={finish} disabled={busy === 'finish'} className="rounded-lg bg-slate-900 px-3 py-1.5 font-bold text-white disabled:opacity-60">Oui, terminer</button>
                <button onClick={() => setConfirmFinish(false)} className="text-slate-500 underline">Annuler</button>
              </div>
            )}
          </div>
        )}
      </section>

      {progress && <TaskProgressCard progress={progress.data} receivedAt={progress.at} live={open} />}

      <section className="ta-card p-4">
        <h3 className="mb-3 font-semibold">Ce que l'agent a constaté et fait</h3>
        {detail.timeline.length === 0 ? (
          <p className="text-sm text-slate-500">Rien d'enregistré pour le moment.</p>
        ) : (
          <>
            {hidden > 0 && (
              <button onClick={() => setShowAll(true)} className="mb-2 text-sm font-semibold text-brand-700">
                Voir les {hidden} événements précédents
              </button>
            )}
            <ol className="space-y-2.5">
              {timeline.map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex gap-3 text-sm">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${KIND_STYLE[e.kind]}`} title={KIND_LABEL[e.kind]} />
                  <span className="min-w-0 flex-1 break-words">{e.text}</span>
                  <time className="shrink-0 text-xs text-slate-400" dateTime={e.at}>{hhmm(e.at)}</time>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className="ta-card p-4" aria-label="Discussion avec le client">
        <h3 className="mb-3 font-semibold">Discussion avec le client</h3>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1" aria-live="polite">
          {messages.length === 0 && <p className="text-sm text-slate-500">Aucun message pour le moment.</p>}
          {messages.map((m) =>
            m.sender === 'system' ? (
              <p key={m.id} className="text-center text-xs text-slate-400">{m.body}</p>
            ) : (
              <div key={m.id} className={`flex ${m.sender === 'technician' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.sender === 'technician' ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-slate-100 text-slate-900'}`}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-0.5 text-[11px] ${m.sender === 'technician' ? 'text-white/70' : 'text-slate-400'}`}>
                    {m.sender === 'technician' ? (m.name ?? 'Technicien') : (client.name?.split(' ')[0] ?? 'Client')} · {hhmm(m.at)}
                  </p>
                </div>
              </div>
            ),
          )}
          <div ref={bottom} />
        </div>

        {session.canWrite ? (
          <form onSubmit={send} className="mt-3 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={1000}
              placeholder="Écrire au client…"
              aria-label="Votre message au client"
              className="ta-input min-w-0 flex-1"
            />
            <button type="submit" disabled={!draft.trim() || busy === 'send'} className="ta-button-primary !w-auto shrink-0 disabled:opacity-50">
              Envoyer
            </button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-slate-500">{open ? "Prenez d'abord la demande en charge pour écrire au client." : "L'assistance est terminée."}</p>
        )}
      </section>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
