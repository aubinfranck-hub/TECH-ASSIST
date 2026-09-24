import { Link, Outlet } from 'react-router-dom';

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <img
      src={dark ? '/logo-white.svg' : '/logo.svg'}
      alt="Tech Assist"
      className="h-10 w-auto object-contain"
    />
  );
}

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="ta-container flex h-[72px] items-center justify-between gap-4">
          <Link to="/" aria-label="Tech Assist - Accueil" className="shrink-0">
            <Brand />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
            <Link to="/diagnostic" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-700">Diagnostic</Link>
            <Link to="/session" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-700">Ma session</Link>
            <Link to="/entreprise" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-brand-50 hover:text-brand-700">Entreprises</Link>
            <Link to="/technicien" className="ml-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">Espace technicien</Link>
          </nav>

          <Link to="/diagnostic" className="ta-button-primary py-2.5 md:hidden">Assistance</Link>
        </div>

        <div className="border-t border-slate-100 md:hidden">
          <nav className="ta-container flex gap-1 overflow-x-auto py-2" aria-label="Navigation mobile">
            <Link to="/diagnostic" className="whitespace-nowrap rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700">Diagnostic</Link>
            <Link to="/session" className="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-slate-600">Ma session</Link>
            <Link to="/entreprise" className="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-slate-600">Entreprises</Link>
            <Link to="/technicien" className="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-slate-600">Technicien</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1"><Outlet /></main>

      <footer className="mt-16 border-t border-slate-200 bg-slate-950 text-slate-300">
        <div className="ta-container grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
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
              <Link to="/diagnostic" className="block hover:text-white">Diagnostic</Link>
              <Link to="/session" className="block hover:text-white">Suivre ma session</Link>
              <Link to="/entreprise" className="block hover:text-white">Espace entreprise</Link>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Informations</p>
            <div className="mt-3 space-y-2 text-sm">
              <Link to="/cgu" className="block hover:text-white">CGU</Link>
              <Link to="/confidentialite" className="block hover:text-white">Confidentialité</Link>
              <Link to="/mentions-legales" className="block hover:text-white">Mentions légales</Link>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="ta-container flex flex-col gap-2 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>© Tech Assist — Assistance informatique à distance.</span>
            <span>Données traitées conformément à la loi n° 2013-450.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
