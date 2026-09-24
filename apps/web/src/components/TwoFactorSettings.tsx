import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';

export function TwoFactorSettings() {
  const [step, setStep] = useState<'idle' | 'setup' | 'done'>('idle');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startSetup() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ secret: string; otpauthUri: string }>('/api/auth/technician/2fa/setup');
      setSecret(res.secret);
      setOtpauthUri(res.otpauthUri);
      setStep('setup');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/technician/2fa/enable', { code });
      setStep('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Code incorrect.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    const disableCode = prompt('Entrez un code de votre application d\'authentification pour désactiver la 2FA :');
    if (!disableCode) return;
    setError(null);
    try {
      await api.post('/api/auth/technician/2fa/disable', { code: disableCode });
      setStep('idle');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Code incorrect.');
    }
  }

  if (step === 'done') {
    return (
      <div className="rounded-lg border bg-white p-4">
        <p className="text-sm text-green-700 mb-2">Authentification à deux facteurs activée ✓</p>
        <button onClick={disable} className="text-sm text-red-600 hover:underline">
          Désactiver la 2FA
        </button>
      </div>
    );
  }

  if (step === 'setup') {
    return (
      <form onSubmit={confirmEnable} className="rounded-lg border bg-white p-4 space-y-3">
        <p className="text-sm text-slate-600">
          Ajoutez ce compte dans une application d'authentification (Google Authenticator, Authy...) en
          scannant l'URI ci-dessous ou en saisissant le secret manuellement, puis entrez le code généré.
        </p>
        <div className="rounded bg-slate-50 p-2 font-mono text-xs break-all">
          <p>Secret : {secret}</p>
          <p className="mt-1 text-slate-500">{otpauthUri}</p>
        </div>
        <input
          required
          placeholder="Code à 6 chiffres"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-center tracking-widest"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Confirmer l'activation
        </button>
      </form>
    );
  }

  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm text-slate-600 mb-3">
        La 2FA n'est pas activée sur ce compte. Recommandé pour tout compte technicien (RS-08).
      </p>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <button
        onClick={startSetup}
        disabled={busy}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
      >
        Activer la 2FA
      </button>
    </div>
  );
}
