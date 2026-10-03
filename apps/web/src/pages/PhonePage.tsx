import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const KEY = 'tech_assist_phone';

interface Saved {
  installId: string;
  token?: string;
  sessionId?: string;
}
interface Entitlements {
  freeOfferAvailable: boolean;
  subscription: { endsAt: string } | null;
  companyCovered?: boolean;
  paidForfait?: { orderId: string; name: string; scope: string } | null;
}

const FORFAITS = [
  { planId: 'diagnostic_express', label: 'Diagnostic', price: '500', text: 'Nous cherchons la cause et vous expliquons quoi faire.' },
  { planId: 'assistance_rapide', label: 'Dépannage', price: '2 000', text: 'Un problème précis réglé avec vous, pas à pas.' },
  { planId: 'session_maintenance', label: 'Intervention complète', price: '5 000', text: 'Accompagnement complet jusqu’à résolution.' },
];
interface Payment {
  orderId: string;
  reference: string;
  amount: number;
  instructions: string;
  url?: string | null;
  automatic?: boolean;
}
interface Turn {
  role: 'user' | 'assistant';
  text: string;
  photo?: boolean;
}

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    /* stockage indisponible */
  }
  const fresh = { installId: `phone-${crypto.randomUUID()}-${Date.now()}` };
  save(fresh);
  return fresh;
}
function save(s: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible : la session reste valable tant que la page est ouverte */
  }
}

class CallError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body: unknown, token?: string, method = 'POST'): Promise<T> {
  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new CallError(data?.error ?? `Erreur ${res.status}`, res.status, data?.code);
  return data as T;
}

/** Réduit une photo d'écran (JPEG, 1000 px max) pour tenir dans la limite du serveur. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  for (const [max, quality] of [[1000, 0.7], [800, 0.6], [600, 0.5]] as const) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
    if (data.length <= 780_000) return data;
  }
  throw new Error('Photo trop lourde. Essayez une capture d’écran plus petite.');
}

export function PhonePage() {
  const [saved, setSaved] = useState<Saved>(load);
  const update = (patch: Partial<Saved>) => {
    const next = { ...saved, ...patch };
    save(next);
    setSaved(next);
  };

  if (!saved.token) return <SignIn installId={saved.installId} onDone={(token) => update({ token })} />;
  return <Assistant saved={saved} onSession={(sessionId) => update({ sessionId })} onLogout={() => update({ token: undefined, sessionId: undefined })} />;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8">
      <h1 className="font-display text-3xl font-extrabold">{title}</h1>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function SignIn({ installId, onDone }: { installId: string; onDone: (token: string) => void }) {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Assistant téléphone">
      <p className="text-slate-600">Un problème sur votre téléphone ? L’assistant vous guide pas à pas. Il ne prend jamais le contrôle de votre téléphone. La première assistance est offerte.</p>
      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (!sent) {
              await call('/app/email-code', { email });
              setSent(true);
            } else {
              const r = await call<{ token: string }>('/app/register', { installId, platform: 'android', email, code, phone });
              onDone(r.token);
            }
          });
        }}
      >
        <label className="block text-sm font-semibold">
          Votre e-mail
          <input className="ta-input mt-1" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={sent} />
        </label>
        {sent && (
          <>
            <p className="text-sm text-slate-600">Un code à 6 chiffres a été envoyé à {email}. Regardez aussi les courriers indésirables.</p>
            <label className="block text-sm font-semibold">
              Code reçu
              <input className="ta-input mt-1" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label className="block text-sm font-semibold">
              Votre téléphone (pour qu’un technicien puisse vous rappeler)
              <input className="ta-input mt-1" type="tel" inputMode="tel" autoComplete="tel" placeholder="+225…" required value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </>
        )}
        {error && <p className="text-sm font-medium text-brand-700">{error}</p>}
        <button className="ta-button-primary" disabled={busy}>{busy ? 'Un instant…' : sent ? 'Continuer' : 'Recevoir le code'}</button>
      </form>
    </Shell>
  );
}

function Assistant({ saved, onSession, onLogout }: { saved: Saved; onSession: (id: string | undefined) => void; onLogout: () => void }) {
  const token = saved.token!;
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      setEnt((await call<{ entitlements: Entitlements }>('/app/me', null, token, 'GET')).entitlements);
    } catch (e) {
      if (e instanceof CallError && e.status === 401) onLogout();
      else setError('Impossible de joindre le serveur. Réessayez.');
    }
  }, [token, onLogout]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [turns]);

  const covered = ent && (ent.freeOfferAvailable || ent.subscription || ent.companyCovered || ent.paidForfait);
  const [payment, setPayment] = useState<Payment | null>(null);

  async function start(orderId?: string) {
    setError(null);
    setBusy(true);
    try {
      const r = await call<{ session: { id: string }; fallbackToHuman: boolean }>('/app/assistance', { mode: 'ia', ...(orderId ? { orderId } : {}) }, token);
      onSession(r.session.id);
      setTurns([{ role: 'assistant', text: r.fallbackToHuman ? 'L’assistant en ligne n’est pas disponible pour le moment : un technicien vous répondra. Décrivez votre problème.' : 'Bonjour, je suis l’assistant Tech Assist. Quel est le problème avec votre téléphone ? Dites la marque et le modèle si vous les connaissez.' }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de démarrer.');
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function order(planId: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ order: { id: string }; payment: { amountFcfa: number; reference: string; instructions: string; url?: string | null; automatic?: boolean } }>('/app/orders', { planId }, token);
      setPayment({ orderId: r.order.id, reference: r.payment.reference, amount: r.payment.amountFcfa, instructions: r.payment.instructions, url: r.payment.url, automatic: r.payment.automatic });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de créer la commande.');
    } finally {
      setBusy(false);
    }
  }

  // Attente de la confirmation du paiement : l'assistance démarre dès qu'un technicien l'a confirmé.
  useEffect(() => {
    if (!payment) return;
    const timer = setInterval(async () => {
      try {
        const r = await call<{ order: { status: string } }>(`/app/orders/${payment.orderId}`, null, token, 'GET');
        if (r.order.status === 'paid') {
          clearInterval(timer);
          setPayment(null);
          start(payment.orderId);
        }
      } catch {
        /* réseau instable : nouvel essai au prochain tour */
      }
    }, 8000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment]);

  async function send() {
    const message = text.trim();
    if (!message || busy || !saved.sessionId) return;
    const history = turns.slice(-10).map((t) => ({ role: t.role, text: t.text.slice(0, 1500) }));
    setTurns((t) => [...t, { role: 'user', text: message, photo: !!photo }]);
    setText('');
    const image = photo ? { mime: 'image/jpeg' as const, data: photo } : undefined;
    setPhoto(null);
    setBusy(true);
    setError(null);
    try {
      const r = await call<{ answer: string }>(`/app/sessions/${saved.sessionId}/chat`, { message, history, ...(image ? { image } : {}) }, token);
      setTurns((t) => [...t, { role: 'assistant', text: r.answer }]);
    } catch (e) {
      if (e instanceof CallError && e.status === 409) {
        onSession(undefined);
        setTurns([]);
        refresh();
      }
      setError(e instanceof Error ? e.message : 'Impossible d’obtenir une réponse.');
    } finally {
      setBusy(false);
    }
  }

  async function pick(file?: File) {
    if (!file) return;
    setError(null);
    try {
      setPhoto(await shrink(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Photo illisible.');
    }
  }

  if (!saved.sessionId) {
    return (
      <Shell title="Assistant téléphone">
        {!ent && !error && <p className="text-slate-600">Chargement…</p>}
        {ent && covered && !payment && (
          <>
            <p className="text-slate-600">
              {ent.companyCovered
                ? 'Votre entreprise couvre cette assistance.'
                : ent.subscription
                  ? 'Votre abonnement est actif.'
                  : ent.paidForfait
                    ? `Votre forfait « ${ent.paidForfait.name} » est payé.`
                    : 'Votre première assistance est offerte.'}
            </p>
            <button className="ta-button-primary mt-5" onClick={() => start(ent.paidForfait?.orderId)} disabled={busy}>{busy ? 'Un instant…' : 'Démarrer l’assistance'}</button>
          </>
        )}
        {ent && !covered && !payment && (
          <>
            <p className="text-slate-600">Votre assistance offerte a été utilisée. Choisissez un forfait, vous ne payez que ce que vous utilisez.</p>
            <ul className="mt-4 space-y-3">
              {FORFAITS.map((f) => (
                <li key={f.planId}>
                  <button className="w-full rounded-xl border border-slate-300 bg-white p-4 text-left hover:border-brand-600 disabled:opacity-60" disabled={busy} onClick={() => order(f.planId)}>
                    <span className="flex items-baseline justify-between gap-3"><span className="font-extrabold">{f.label}</span><span className="font-extrabold text-brand-700">{f.price} FCFA</span></span>
                    <span className="mt-1 block text-sm text-slate-600">{f.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {payment && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="font-extrabold">{payment.amount.toLocaleString('fr-FR')} FCFA à payer</p>
            <p className="mt-2 text-sm text-slate-700">Référence : <strong>{payment.reference}</strong></p>
            {payment.automatic && payment.url ? (
              <>
                <a href={payment.url} target="_blank" rel="noreferrer" className="ta-button-primary mt-4 inline-flex">Payer maintenant</a>
                <p className="mt-3 text-sm text-slate-600">Après le paiement, revenez sur cette page : l’assistance démarre toute seule.</p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-slate-600">{payment.instructions}</p>
                <p className="mt-3 text-sm text-slate-600">Gardez cette page ouverte : l’assistance démarre dès que le paiement est confirmé par un technicien.</p>
              </>
            )}
          </div>
        )}
        {info && <p className="mt-4 text-sm text-slate-700">{info}</p>}
        {error && <p className="mt-4 text-sm font-medium text-brand-700">{error}</p>}
        <button className="mt-8 text-sm text-slate-500 underline" onClick={onLogout}>Changer d’e-mail</button>
        <p className="mt-6 text-xs text-slate-500">
          Sur ordinateur Windows, installez plutôt <Link to="/assistance" className="underline">l’application Tech Assist</Link>.
        </p>
      </Shell>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-4" style={{ minHeight: 'calc(100dvh - 72px)' }}>
      <div className="flex-1 space-y-3 pb-4" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#14181f] px-4 py-2.5 text-white' : 'max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white px-4 py-3 text-slate-800 shadow-card'}>
            {t.text}
            {t.photo && <span className="mt-1 block text-xs opacity-70">Photo jointe</span>}
          </div>
        ))}
        {busy && <p className="text-sm text-slate-500">L’assistant écrit…</p>}
        <div ref={bottom} />
      </div>
      {error && <p className="mb-2 text-sm font-medium text-brand-700">{error}</p>}
      <p className="mb-2 text-xs text-slate-500">Ne donnez jamais de mot de passe, de code PIN ou de code reçu par SMS.</p>
      <form
        className="sticky bottom-0 flex items-end gap-2 bg-[#f6f7f9] pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white text-lg" aria-label="Joindre une photo d’écran" title="Joindre une photo d’écran">
          {photo ? '✓' : '📷'}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <textarea className="ta-input min-h-11 flex-1 resize-none" rows={1} maxLength={1000} placeholder="Décrivez le problème…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="ta-button-primary w-auto shrink-0" disabled={busy || !text.trim()}>Envoyer</button>
      </form>
    </div>
  );
}
