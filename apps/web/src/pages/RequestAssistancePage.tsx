import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

type Platform = 'web' | 'windows' | 'android';
type Mode = 'ia' | 'humain';

export function RequestAssistancePage() {
  const navigate = useNavigate();
  const [platform, setPlatform] = useState<Platform>('web');
  const [mode, setMode] = useState<Mode>('ia');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.post<{ session: { session_code: string } }>('/api/assistance/start', {
        clientPhone: phone.trim(),
        clientName: name.trim() || undefined,
        problem: problem.trim() || undefined,
        platform,
        requestedMode: mode,
      });
      navigate(`/session?code=${encodeURIComponent(result.session.session_code)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de démarrer l’assistance.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ta-container max-w-2xl py-12">
      <div className="mb-6">
        <p className="ta-eyebrow mb-2">Tech Assist</p>
        <h1 className="text-2xl font-bold sm:text-3xl">🆘 Demander de l’aide</h1>
        <p className="mt-2 text-slate-600">Assistance IA ou technicien, depuis le navigateur ou l’application.</p>
      </div>

      <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 p-5">
        <p className="font-bold text-green-900">🎉 Lancement : assistance gratuite</p>
        <p className="mt-1 text-sm text-green-800">Aucun paiement demandé pendant la période de lancement. Les tarifs habituels restent affichés à titre indicatif.</p>
      </div>

      <form onSubmit={submit} className="ta-card space-y-5 p-6 sm:p-8">
        <div>
          <label className="mb-2 block text-sm font-semibold">Votre appareil</label>
          <div className="grid gap-2 sm:grid-cols-3">
            {([['web','Navigateur'],['windows','PC Windows'],['android','Téléphone']] as [Platform,string][]).map(([value,label]) => (
              <button key={value} type="button" onClick={() => setPlatform(value)}
                className={`rounded-xl border p-3 text-sm font-semibold ${platform === value ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold">Type d’assistance</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setMode('ia')}
              className={`rounded-xl border p-4 text-left ${mode === 'ia' ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
              <span className="font-bold">🤖 Agent IA</span>
              <span className="mt-1 block text-xs text-slate-500"><s>500 FCFA</s> · GRATUIT actuellement</span>
            </button>
            <button type="button" onClick={() => setMode('humain')}
              className={`rounded-xl border p-4 text-left ${mode === 'humain' ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
              <span className="font-bold">👨‍🔧 IA + technicien</span>
              <span className="mt-1 block text-xs text-slate-500"><s>2 000 FCFA</s> · GRATUIT actuellement</span>
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="ta-problem" className="mb-2 block text-sm font-semibold">Quel est votre problème ?</label>
          <textarea id="ta-problem" value={problem} onChange={e => setProblem(e.target.value)}
            rows={4} className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-brand-600"
            placeholder="Ex. Internet ne fonctionne plus, imprimante bloquée, logiciel qui ne démarre pas..." />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">Téléphone
            <input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+2250700000000"
              className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal outline-none focus:border-brand-600" />
          </label>
          <label className="text-sm font-semibold">Nom (facultatif)
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Votre nom"
              className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal outline-none focus:border-brand-600" />
          </label>
        </div>

        {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <button disabled={loading} className="ta-button-primary w-full justify-center py-3">
          {loading ? 'Démarrage…' : '🆘 DEMANDER DE L’AIDE — GRATUIT'}
        </button>
      </form>
    </div>
  );
}
