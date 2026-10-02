import { Link, Outlet } from 'react-router-dom';

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Tech Assist">
      <img
        src="/logo-mark.svg"
        alt=""
        className="h-9 w-9 shrink-0 rounded-[10px] object-contain sm:h-10 sm:w-10"
      />
      <span className={`font-display text-[18px] font-extrabold tracking-[-0.03em] sm:text-[20px] ${dark ? 'text-white' : 'text-slate-950'}`}>
        Tech<span className="text-brand-600">Assist</span>
      </span>
    </span>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-[#f6f7f9]">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
        <div className="ta-container flex h-16 items-center justify-between gap-3 sm:h-[72px]">
          <Link to="/" aria-label="Tech Assist - Accueil" className="shrink-0">
            <Brand />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
            <Link to="/assistance" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-700">Assistance</Link>
            <Link to="/session" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-700">Ma session</Link>
            <Link to="/entreprise" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-700">Entreprises</Link>
            <Link to="/technicien" className="ml-2 rounded-lg bg-[#14181f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">Espace technicien</Link>
          </nav>

          <details className="group relative md:hidden">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-300 marker:hidden" aria-label="Menu">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h12M3 9h12M3 13h12" /></svg>
            </summary>
            <nav className="absolute right-0 top-12 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-soft" aria-label="Navigation mobile">
              <Link to="/assistance" className="block rounded-lg px-3 py-2.5 font-semibold text-brand-700">Installer l’application</Link>
              <Link to="/session" className="block rounded-lg px-3 py-2.5 text-slate-700">Ma session</Link>
              <Link to="/entreprise" className="block rounded-lg px-3 py-2.5 text-slate-700">Entreprises</Link>
              <Link to="/technicien" className="block rounded-lg px-3 py-2.5 text-slate-700">Espace technicien</Link>
            </nav>
          </details>
        </div>

      </header>

      <main className="flex-1"><Outlet /></main>

      <footer className="mt-14 border-t border-slate-200 bg-[#14181f] text-slate-300 sm:mt-16">
        <div className="ta-container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:py-12">
          <div className="lg:col-span-2">
            <Brand dark />
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
              Assistance informatique à distance pour particuliers et PME en Côte d'Ivoire.
              Diagnostic, accompagnement technique et sessions assistées.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Services</p>
            <div className="mt-3 space-y-2 text-sm">
              <Link to="/assistance" className="block transition hover:text-white">Assistance</Link>
              <Link to="/session" className="block transition hover:text-white">Suivre ma session</Link>
              <Link to="/entreprise" className="block transition hover:text-white">Espace entreprise</Link>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Informations</p>
            <div className="mt-3 space-y-2 text-sm">
              <Link to="/cgu" className="block transition hover:text-white">CGU</Link>
              <Link to="/confidentialite" className="block transition hover:text-white">Confidentialité</Link>
              <Link to="/mentions-legales" className="block transition hover:text-white">Mentions légales</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="ta-container flex flex-col gap-2 py-4 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>© Tech Assist — Assistance informatique à distance.</span>
            <span>Données traitées conformément à la loi n° 2013-450.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
