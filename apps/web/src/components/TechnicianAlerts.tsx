import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { deviceSubscribed, disablePush, enablePush, PushError, pushSupport } from '../lib/push.js';

interface Alerts {
  name: string;
  onDuty: boolean;
  alertEmail: string | null;
  devices: number;
  push: { available: boolean; publicKey: string | null };
}

const message = (err: unknown) => (err instanceof ApiError || err instanceof PushError ? err.message : 'Une erreur est survenue. Réessayez.');

/** Permanence et alertes : être prévenu, sur ce téléphone ou cet ordinateur, quand un client demande un technicien. */
export function TechnicianAlerts() {
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [here, setHere] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const support = pushSupport();

  const load = useCallback(async () => {
    try {
      const a = await api.get<Alerts>('/api/technician/alerts');
      setAlerts(a);
      setEmail((current) => (current === '' ? (a.alertEmail ?? '') : current));
      setHere(await deviceSubscribed());
    } catch (err) {
      setError(message(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setInfo(null);
    try {
      await work();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  const toggleDuty = () =>
    run('duty', async () => {
      const res = await api.patch<{ onDuty: boolean }>('/api/technician/alerts', { onDuty: !alerts!.onDuty });
      setAlerts({ ...alerts!, onDuty: res.onDuty });
    });

  const saveEmail = () =>
    run('email', async () => {
      const res = await api.patch<{ alertEmail: string | null }>('/api/technician/alerts', { alertEmail: email.trim() });
      setAlerts({ ...alerts!, alertEmail: res.alertEmail });
      setEmail(res.alertEmail ?? '');
      setInfo(res.alertEmail ? 'Adresse enregistrée.' : 'Adresse retirée.');
    });

  const enable = () =>
    run('push', async () => {
      await enablePush(alerts!.push.publicKey!);
      await load();
      setInfo('Notifications activées sur cet appareil. Envoyez un essai pour vérifier.');
    });

  const disable = () =>
    run('push', async () => {
      await disablePush();
      await load();
    });

  const test = () =>
    run('test', async () => {
      const res = await api.post<{ devices: number; sent: number }>('/api/technician/push/test');
      setInfo(
        res.sent > 0
          ? `Notification envoyée sur ${res.sent} appareil${res.sent > 1 ? 's' : ''}. Vous devriez la voir dans quelques secondes.`
          : res.devices > 0
            ? "L'envoi a échoué. Désactivez puis réactivez les notifications sur cet appareil."
            : "Aucun appareil enregistré : activez d'abord les notifications.",
      );
    });

  if (!alerts) return <div className="ta-card p-4 text-sm text-slate-500">{error ?? 'Chargement…'}</div>;

  const emailChanged = email.trim().toLowerCase() !== (alerts.alertEmail ?? '');

  return (
    <section className="ta-card divide-y divide-slate-100" aria-label="Permanence et alertes">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className="font-semibold">{alerts.onDuty ? 'Vous êtes de permanence' : 'Vous n’êtes pas de permanence'}</p>
          <p className="text-sm text-slate-500">
            {alerts.onDuty ? 'Vous êtes prévenu dès qu’un client demande un technicien.' : 'Vous ne recevez aucune alerte. Les demandes restent visibles dans la file.'}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={alerts.onDuty}
          aria-label="De permanence"
          onClick={toggleDuty}
          disabled={busy === 'duty'}
          className={`relative h-8 w-14 shrink-0 rounded-full transition ${alerts.onDuty ? 'bg-emerald-500' : 'bg-slate-300'} disabled:opacity-60`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${alerts.onDuty ? 'left-7' : 'left-1'}`} />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-sm font-semibold">Notifications sur cet appareil</p>
        {!alerts.push.available && (
          <p className="text-sm text-slate-500">Les notifications du téléphone ne sont pas encore configurées sur le serveur : vous serez prévenu par email.</p>
        )}
        {alerts.push.available && support === 'ios-install' && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Sur iPhone : ouvrez cette page dans Safari, touchez le bouton Partager, puis « Sur l'écran d'accueil ». Ouvrez ensuite Tech Assist depuis l'icône pour activer les notifications.
          </p>
        )}
        {alerts.push.available && support === 'unsupported' && (
          <p className="text-sm text-slate-500">Ce navigateur ne permet pas les notifications. Utilisez Chrome (Android, ordinateur) ou Safari avec l'icône sur l'écran d'accueil (iPhone).</p>
        )}
        {alerts.push.available && support === 'ok' && (
          <div className="flex flex-wrap items-center gap-2">
            {!here ? (
              <button onClick={enable} disabled={busy === 'push'} className="ta-button-primary !w-auto !py-2.5 disabled:opacity-60">
                {busy === 'push' ? 'Activation…' : 'Activer les notifications'}
              </button>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Actives sur cet appareil
                </span>
                <button onClick={test} disabled={busy === 'test'} className="ta-button-secondary !w-auto !py-2 disabled:opacity-60">
                  {busy === 'test' ? 'Envoi…' : 'Envoyer un essai'}
                </button>
                <button onClick={disable} disabled={busy === 'push'} className="text-sm text-slate-500 underline">
                  Désactiver
                </button>
              </>
            )}
          </div>
        )}
        {alerts.devices > 0 && <p className="text-xs text-slate-400">{alerts.devices} appareil{alerts.devices > 1 ? 's' : ''} enregistré{alerts.devices > 1 ? 's' : ''} pour votre compte.</p>}
      </div>

      <form
        className="space-y-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void saveEmail();
        }}
      >
        <label htmlFor="alert-email" className="text-sm font-semibold">
          Recevoir aussi l'alerte par email
        </label>
        <div className="flex gap-2">
          <input id="alert-email" type="email" inputMode="email" autoComplete="email" placeholder="vous@exemple.com" value={email} onChange={(e) => setEmail(e.target.value)} className="ta-input min-w-0 flex-1" />
          <button type="submit" disabled={!emailChanged || busy === 'email'} className="ta-button-secondary !w-auto shrink-0 disabled:opacity-50">
            Enregistrer
          </button>
        </div>
      </form>

      {(error || info) && (
        <p role="status" className={`p-4 text-sm ${error ? 'text-red-600' : 'text-emerald-700'}`}>
          {error ?? info}
        </p>
      )}
    </section>
  );
}
