import { Link, useLocation } from 'react-router-dom';

export function NotFoundPage() {
  const location = useLocation();
  return (
    <div className="ta-container flex min-h-[70vh] items-center justify-center py-14">
      <div className="w-full max-w-2xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-xl">
        <div className="bg-slate-950 p-8 text-white sm:p-10">
          <p className="text-xs font-black uppercase tracking-[.2em] text-slate-400">TECH ASSIST / NAVIGATION</p>
          <p className="mt-4 font-display text-6xl font-black">404</p>
          <h1 className="mt-2 text-2xl font-black">Cette page n’existe plus</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">Le menu demandé a peut-être été déplacé. Vous pouvez reprendre directement depuis l’espace correspondant.</p>
          <p className="mt-3 break-all text-xs text-slate-500">{location.pathname}</p>
        </div>
        <div className="grid gap-3 p-6 sm:grid-cols-2 sm:p-8">
          <Link to="/demander-aide" className="rounded-2xl bg-brand-600 p-4 text-sm font-black text-white hover:bg-brand-700">🆘 Demander de l’aide</Link>
          <Link to="/assistance" className="rounded-2xl border border-slate-200 p-4 text-sm font-black hover:bg-slate-50">Comment ça marche</Link>
          <Link to="/entreprise" className="rounded-2xl border border-slate-200 p-4 text-sm font-black hover:bg-slate-50">🏢 Espace entreprise</Link>
          <Link to="/technicien" className="rounded-2xl border border-slate-200 p-4 text-sm font-black hover:bg-slate-50">🛠️ Espace technicien</Link>
          <Link to="/partenaire" className="rounded-2xl border border-slate-200 p-4 text-sm font-black hover:bg-slate-50">🤝 Partenaires</Link>
          <Link to="/" className="rounded-2xl border border-slate-200 p-4 text-sm font-black hover:bg-slate-50">← Accueil</Link>
        </div>
      </div>
    </div>
  );
}
