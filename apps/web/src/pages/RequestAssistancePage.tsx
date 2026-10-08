import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';

const AGENT_URL = 'https://github.com/aubinfranck-hub/TECH-ASSIST/releases/download/agent-latest/tech-assist-agent.exe';

interface StartResponse {
  session: { id: string; session_code: string };
}

/**
 * Point d'entrée unique du client : il décrit son problème ici, l'assistance démarre tout de suite, et il arrive sur sa session
 * (discussion avec l'IA, bouton « parler à un technicien », partage d'écran avec son accord). Les applications sont l'autre voie.
 */
export function RequestAssistancePage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [mode, setMode] = useState<'ia' | 'humain'>('ia');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<StartResponse>('/api/assistance/start', {
        clientPhone: phone.replace(/[\s().-]/g, ''),
        ...(name.trim() ? { clientName: name.trim() } : {}),
        ...(problem.trim() ? { problem: problem.trim() } : {}),
        platform: 'web',
        requestedMode: mode,
      });
      navigate(`/session?code=${res.session.session_code}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) setError("Cette assistance demande un paiement. Utilisez l'application Tech Assist, ou contactez-nous.");
      else if (err instanceof ApiError && err.status === 400) setError('Vérifiez votre numéro de téléphone (8 à 15 chiffres, avec ou sans +).');
      else setError(err instanceof ApiError ? err.message : "Impossible de démarrer l'assistance. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ta-container max-w-3xl py-10 sm:py-14">
      <p className="ta-eyebrow">DEMANDER DE L’AIDE</p>
      <h1 className="mt-2 font-display text-3xl font-black sm:text-4xl">Décrivez votre problème, on s’en occupe.</h1>
      <p className="mt-3 text-slate-600">
        C’est tout ce qu’il faut faire ici : l’assistance démarre aussitôt. Une IA vous guide d’abord ; si elle ne suffit pas, un technicien prend le relais et, avec votre accord, peut voir votre écran.
      </p>

      <ol className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ['1', 'Vous décrivez', 'Votre numéro et votre problème, en une phrase.'],
          ['2', 'L’IA vous guide', 'Des étapes simples, tout de suite.'],
          ['3', 'Un technicien si besoin', 'Il voit votre écran seulement si vous l’autorisez.'],
        ].map(([n, t, d]) => (
          <li key={n} className="rounded-2xl bg-slate-950 p-4 text-white">
            <span className="text-xs font-black text-brand-400">ÉTAPE {n}</span>
            <p className="mt-1 font-black">{t}</p>
            <p className="mt-1 text-sm text-slate-400">{d}</p>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="ta-card mt-6 space-y-4 p-5 sm:p-7">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">
            Votre numéro de téléphone *
            <input required inputMode="tel" autoComplete="tel" placeholder="+225 07 00 00 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} className="ta-input mt-1" />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Votre prénom (facultatif)
            <input autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="ta-input mt-1" />
          </label>
        </div>
        <label className="block text-sm font-semibold text-slate-700">
          Quel est votre problème ?
          <textarea rows={4} maxLength={1000} placeholder="Ex. : mon ordinateur est très lent depuis ce matin, Outlook ne s’ouvre plus…" value={problem} onChange={(e) => setProblem(e.target.value)} className="ta-input mt-1" />
        </label>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-700">Comment voulez-vous être aidé ?</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {([
              ['ia', '🤖 L’IA d’abord', 'Réponse immédiate. Vous pouvez demander un technicien à tout moment.'],
              ['humain', '🧑‍🔧 Un technicien directement', 'Un technicien est prévenu tout de suite et vous répond.'],
            ] as const).map(([value, title, text]) => (
              <label key={value} className={`cursor-pointer rounded-xl border p-4 text-sm ${mode === value ? 'border-brand-600 bg-brand-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="sr-only" />
                <span className="block font-black text-slate-950">{title}</span>
                <span className="mt-1 block text-slate-600">{text}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
        <button disabled={busy || phone.trim().length < 8} className="ta-button-primary w-full disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Démarrage…' : 'Démarrer mon assistance →'}
        </button>
        <p className="text-center text-xs text-slate-500">Gratuit pendant le lancement. Votre numéro sert uniquement à vous joindre pour cette assistance.</p>
      </form>

      <section className="mt-10">
        <h2 className="font-display text-xl font-black">Vous préférez une application ?</h2>
        <p className="mt-1 text-sm text-slate-600">L’agent Windows répare directement votre PC avec votre accord. L’application Android guide votre téléphone.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <a href={AGENT_URL} className="inline-flex min-h-12 items-center rounded-xl bg-slate-950 px-5 font-black text-white hover:bg-slate-800">↓ Télécharger l’agent Windows</a>
          <Link to="/telephone" className="inline-flex min-h-12 items-center rounded-xl border border-slate-200 bg-white px-5 font-black text-slate-900 hover:bg-slate-50">📱 Application Android</Link>
        </div>
      </section>

      <p className="mt-8 text-sm text-slate-600">
        Vous avez déjà un code à 9 chiffres ? <Link to="/session" className="font-bold text-brand-700 hover:underline">Retrouver ma session →</Link>
      </p>
    </div>
  );
}
