import { Link, Outlet, useLocation } from 'react-router-dom';

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Tech Assist">
      <img src="/logo-mark.svg" alt="" className="h-9 w-9 shrink-0 rounded-xl object-contain sm:h-10 sm:w-10" />
      <span className={`font-display text-[18px] font-extrabold tracking-[-0.04em] sm:text-[20px] ${dark ? 'text-white' : 'text-slate-950'}`}>
        Tech<span className="text-brand-600">Assist</span>
      </span>
    </span>
  );
}

export function Layout() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
        <div className="ta-container flex h-[68px] items-center justify-between gap-4 sm:h-[76px]">
          <Link to="/" aria-label="Tech Assist - Accueil" className="shrink-0"><Brand /></Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
            <Link to="/assistance" className={`ta-nav-link ${location.pathname === '/assistance' ? 'ta-nav-link-active' : ''}`}>Assistance</Link>
            <Link to="/diagnostic" className={`ta-nav-link ${location.pathname === '/diagnostic' ? 'ta-nav-link-active' : ''}`}>Diagnostic</Link>
            <Link to="/session" className={`ta-nav-link ${location.pathname === '/session' ? 'ta-nav-link-active' : ''}`}>Ma session</Link>
            <Link to="/entreprise" className={`ta-nav-link ${location.pathname === '/entreprise' ? 'ta-nav-link-active' : ''}`}>Entreprises</Link>
            <Link to="/technicien" className="ml-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">Espace technicien</Link>
            <Link to="/assistance" className="ml-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700">Commencer maintenant</Link>
          </nav>

          <details className="group relative md:hidden">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-300 bg-white marker:hidden" aria-label="Menu">
              <svg width="19" height="19" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h12M3 9h12M3 13h12" /></svg>
            </summary>
            <nav className="absolute right-0 top-12 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-soft" aria-label="Navigation mobile">
              <Link to="/" className="block rounded-xl px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50">Accueil</Link>
              <Link to="/assistance" className="block rounded-xl px-4 py-3 font-semibold text-brand-700 hover:bg-brand-50">Installer l’application</Link>
              <Link to="/diagnostic" className="block rounded-xl px-4 py-3 text-slate-700 hover:bg-slate-50">Diagnostic</Link>
              <Link to="/session" className="block rounded-xl px-4 py-3 text-slate-700 hover:bg-slate-50">Ma session</Link>
              <Link to="/entreprise" className="block rounded-xl px-4 py-3 text-slate-700 hover:bg-slate-50">Entreprises</Link>
              <Link to="/telephone" className="block rounded-xl px-4 py-3 text-slate-700 hover:bg-slate-50">Assistant téléphone</Link>
              <Link to="/technicien" className="block rounded-xl px-4 py-3 text-slate-700 hover:bg-slate-50">Espace technicien</Link>
            </nav>
          </details>
        </div>
      </header>

      <main className="flex-1">{isHome && <div className="h-1 bg-gradient-to-r from-brand-700 via-brand-500 to-orange-400" />}<Outlet /></main>

      <footer className="mt-14 border-t border-slate-200 bg-[#11151b] text-slate-300 sm:mt-16">
        <div className="ta-container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-4 lg:py-14">
          <div className="lg:col-span-2">
            <Brand dark />
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
              Assistance informatique à distance pour particuliers et PME en Côte d'Ivoire.
              Diagnostic, accompagnement technique et sessions assistées.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Assistance à distance
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-white">Services</p>
            <div className="mt-4 space-y-2.5 text-sm">
              <Link to="/assistance" className="block transition hover:text-white">Assistance</Link>
              <Link to="/diagnostic" className="block transition hover:text-white">Diagnostic en ligne</Link>
              <Link to="/session" className="block transition hover:text-white">Suivre ma session</Link>
              <Link to="/entreprise" className="block transition hover:text-white">Espace entreprise</Link>
            </div>
          </div>
          <div>
            <p className="text-sm font-bold text-white">Informations</p>
            <div className="mt-4 space-y-2.5 text-sm">
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
