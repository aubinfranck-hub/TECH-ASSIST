import { Link, Outlet } from 'react-router-dom';

function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <img
      src={dark ? '/logo-white.svg' : '/logo.svg'}
      alt="Tech Assist"
      className="h-9 w-auto object-contain sm:h-10"
    />
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
        <div className="ta-container flex h-16 items-center justify-between gap-3 sm:h-[72px]">
          <Link to="/" aria-label="Tech Assist - Accueil" className="shrink-0">
            <Brand />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation principale">
            <Link to="/diagnostic" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-700">Diagnostic</Link>
            <Link to="/session" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-700">Ma session</Link>
            <Link to="/entreprise" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-700">Entreprises</Link>
            <Link to="/technicien" className="ml-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">Espace technicien</Link>
          </nav>

          <Link to="/diagnostic" className="ta-button-primary min-h-10 w-auto px-4 py-2 text-xs sm:text-sm md:hidden">
            Assistance
          </Link>
        </div>

        <div className="border-t border-slate-100 md:hidden">
          <nav className="ta-container flex gap-1 overflow-x-auto py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Navigation mobile">
            <Link to="/diagnostic" className="whitespace-nowrap rounded-lg bg-brand-50 px-3 py-2 text-[11px] font-bold text-brand-700">Diagnostic</Link>
            <Link to="/session" className="whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-medium text-slate-600">Ma session</Link>
            <Link to="/entreprise" className="whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-medium text-slate-600">Entreprises</Link>
            <Link to="/technicien" className="whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-medium text-slate-600">Technicien</Link>
          </nav>
        </div>
      </header>

      <main className="flex-1"><Outlet /></main>

      <footer className="mt-14 border-t border-slate-200 bg-slate-950 text-slate-300 sm:mt-16">
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
              <Link to="/diagnostic" className="block transition hover:text-white">Diagnostic</Link>
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
