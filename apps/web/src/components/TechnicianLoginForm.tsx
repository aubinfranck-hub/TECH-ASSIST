import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';

export function TechnicianLoginForm({ onLoggedIn }: { onLoggedIn: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [preAuthToken, setPreAuthToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ token?: string; requiresTotp?: boolean; preAuthToken?: string }>(
        '/api/auth/technician/login',
        { username, password },
      );
      if (res.requiresTotp && res.preAuthToken) {
        setPreAuthToken(res.preAuthToken);
      } else if (res.token) {
        onLoggedIn(res.token);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur de connexion.');
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post<{ token: string }>('/api/auth/technician/login/totp', { preAuthToken, code });
      onLoggedIn(res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Code incorrect.');
    }
  }

  if (preAuthToken) {
    return (
      <form onSubmit={submitTotp} className="space-y-4">
        <p className="text-sm text-slate-500">Entrez le code à 6 chiffres de votre application d'authentification.</p>
        <input
          required
          placeholder="Code à 6 chiffres"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="ta-input text-center text-lg tracking-[0.3em]"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="ta-button-primary w-full">
          Valider
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} className="space-y-4">
      <input
        required
        placeholder="Identifiant"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="ta-input"
      />
      <input
        required
        type="password"
        placeholder="Mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="ta-input"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="ta-button-primary w-full">
        Se connecter
      </button>
    </form>
  );
}
