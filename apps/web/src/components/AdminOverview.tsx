import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

interface Overview {
  onDuty: number;
  active: number;
  waiting: number;
  today: number;
  paidToday: number;
  pendingPayments: number;
  alerts: string[];
  recent: { session_code: string; status: string; mode: string; created_at: string; technician: string | null }[];
}

const STATUS: Record<string, string> = { created: '🟠 créée', waiting_technician: '🟠 attend un technicien', active: '🟢 en cours', completed: '✓ terminée', cancelled: 'annulée' };

/** Supervision : ce qui se passe maintenant et ce qui demande une action. */
export function AdminOverview() {
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => {
    const load = () => api.get<Overview>('/api/admin/overview').then(setO).catch(() => undefined);
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  if (!o) return null;
  const tiles: [string, string][] = [
    ['Techniciens de permanence', String(o.onDuty)],
    ['Sessions en cours', String(o.active)],
    ['Demandes en attente', String(o.waiting)],
    ['Demandes aujourd\'hui', String(o.today)],
    ['CA aujourd\'hui', `${o.paidToday.toLocaleString('fr-FR')} FCFA`],
  ];
  return (
    <section aria-label="Supervision" className="space-y-4">
      <h2 className="font-semibold">Supervision</h2>
      {o.alerts.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          {o.alerts.map((a) => (
            <li key={a}>⚠️ {a}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-lg font-bold">{value}</p>
          </div>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-100">
          <tr>
            <th className="p-2 text-left">Heure</th>
            <th className="p-2 text-left">Session</th>
            <th className="p-2 text-left">Technicien</th>
            <th className="p-2 text-left">Statut</th>
          </tr>
        </thead>
        <tbody>
          {o.recent.map((r) => (
            <tr key={r.session_code} className="border-t">
              <td className="p-2">{new Date(r.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
              <td className="p-2">{r.session_code}</td>
              <td className="p-2">{r.technician ?? (r.mode === 'ia' ? 'IA' : '—')}</td>
              <td className="p-2">{STATUS[r.status] ?? r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
