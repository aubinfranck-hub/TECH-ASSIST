import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

const AGENT_URL = 'https://github.com/aubinfranck-hub/TECH-ASSIST/releases/download/agent-latest/tech-assist-agent.exe';

/**
 * Le site est le miroir de l'application : tout se passe dans l'exe. Ici, on le télécharge, et on suit sa demande avec son
 * numéro d'aide (celui qui s'affiche en haut de la fenêtre de l'exe).
 */
export function RequestAssistancePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const digits = code.replace(/\D/g, '');

  return (
    <div className="ta-container max-w-3xl py-10 sm:py-14">
      <p className="ta-eyebrow">DEMANDER DE L’AIDE</p>
      <h1 className="mt-2 font-display text-3xl font-black sm:text-4xl">Un petit programme, et un technicien vous aide.</h1>
      <p className="mt-3 text-slate-600">C’est comme AnyDesk : pas de compte à créer. Vous téléchargez, vous ouvrez, et un numéro d’aide s’affiche.</p>

      <a href={AGENT_URL} className="ta-button-primary mt-6 w-full text-lg sm:w-auto sm:px-10">↓ Télécharger Tech Assist pour Windows</a>

      <ol className="mt-8 space-y-3">
        {[
          ['1', 'Ouvrez le fichier téléchargé', 'Acceptez la demande de Windows. Une fenêtre s’ouvre avec un assistant.'],
          ['2', 'Décrivez votre problème', 'L’assistant vous répond tout de suite, par écrit ou à voix haute, et peut réparer votre PC avec votre accord.'],
          ['3', 'Besoin d’un technicien ? Donnez-lui votre numéro', 'Votre numéro d’aide est en haut de la fenêtre. Le technicien le tape, vous cliquez « Accepter », et il voit votre écran.'],
        ].map(([n, t, d]) => (
          <li key={n} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-black text-white">{n}</span>
            <div>
              <p className="font-black text-slate-950">{t}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">{d}</p>
            </div>
          </li>
        ))}
      </ol>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (digits.length === 9) navigate(`/session?code=${digits}`);
        }}
        className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-5"
      >
        <p className="font-black text-slate-950">Suivre ma demande</p>
        <p className="mt-1 text-sm text-slate-600">Tapez votre numéro d’aide pour voir où en est votre demande et écrire au technicien depuis ce site.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            inputMode="numeric"
            autoComplete="off"
            placeholder="123 456 789"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 11))}
            className="ta-input flex-1 text-center font-mono text-xl tracking-[0.2em]"
            aria-label="Votre numéro d'aide"
          />
          <button disabled={digits.length !== 9} className="ta-button-secondary !w-auto px-6 disabled:opacity-50">Voir ma demande</button>
        </div>
      </form>

      <p className="mt-8 text-sm text-slate-600">
        Sur téléphone Android ? <Link to="/telephone" className="font-bold text-brand-700 hover:underline">Application Android →</Link>
      </p>
    </div>
  );
}
