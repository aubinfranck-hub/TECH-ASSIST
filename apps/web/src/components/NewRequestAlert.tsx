import { useEffect, useRef, useState } from 'react';
import { audioContext, newRequests, notifyRequest, ringDingDong } from '../lib/dingdong.js';
import { nativeBridge } from '../lib/nativeBridge.js';

const REPEAT_MS = 60_000;

/** Ding-dong + notification dès qu'une demande de technicien arrive ; il se répète chaque minute tant qu'une demande attend. */
function AlertPanel({ ids }: { ids: string[] }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem('ta_ding') !== 'off';
    } catch {
      return true;
    }
  });
  const [blocked, setBlocked] = useState(false);
  const ctx = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const ring = async () => {
    if (!ctx.current) ctx.current = audioContext();
    const ok = ctx.current ? await ringDingDong(ctx.current) : false;
    setBlocked(!ok);
    return ok;
  };

  useEffect(() => {
    const { fresh, seen: next } = newRequests(seen.current, ids);
    seen.current = next;
    if (enabled && fresh.length > 0) {
      void ring();
      notifyRequest('Un client demande un technicien', fresh.length > 1 ? `${fresh.length} nouvelles demandes` : 'Ouvrez Tech Assist pour la prendre.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  useEffect(() => {
    if (!enabled || ids.length === 0) return;
    const t = setInterval(() => void ring(), REPEAT_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ids.length > 0]);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    try {
      localStorage.setItem('ta_ding', next ? 'on' : 'off');
    } catch {
      /* préférence non conservée */
    }
    if (next) {
      void ring(); // ce clic autorise aussi l'audio du navigateur
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission();
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 text-sm ${enabled && blocked ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'}`} role="status">
      <span aria-hidden>{enabled ? '🔔' : '🔕'}</span>
      <span className="flex-1">
        {enabled
          ? blocked
            ? 'Cliquez sur « Tester le son » : le navigateur attend un clic avant de pouvoir sonner.'
            : 'Alerte sonore active : un ding-dong sonne dès qu’un client demande de l’aide.'
          : 'Alerte sonore coupée.'}
      </span>
      {enabled && (
        <button type="button" onClick={() => void ring()} className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold hover:bg-slate-50">
          Tester le son
        </button>
      )}
      <button type="button" onClick={toggle} className="rounded-lg bg-slate-950 px-3 py-1.5 font-semibold text-white">
        {enabled ? 'Couper' : 'Activer'}
      </button>
    </div>
  );
}

/** Application Android : le son et la notification viennent de l'application elle-même (même écran éteint) ; pas de doublon dans la page. */
export function NewRequestAlert({ ids }: { ids: string[] }) {
  return nativeBridge() ? null : <AlertPanel ids={ids} />;
}
