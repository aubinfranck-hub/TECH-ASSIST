import { Link, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-brand-700">
            Tech Assist
          </Link>
          <nav className="flex gap-4 text-sm text-slate-600">
            <Link to="/diagnostic" className="hover:text-brand-600">
              Diagnostic
            </Link>
            <Link to="/session" className="hover:text-brand-600">
              Ma session
            </Link>
            <Link to="/technicien" className="hover:text-brand-600">
              Espace technicien
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t bg-white py-8 text-center text-sm text-slate-500">
        <p>Tech Assist — Assistance informatique à distance. Paiement Mobile Money.</p>
        <p className="mt-1">
          En Côte d'Ivoire, vos données sont traitées conformément à la loi n° 2013-450.
        </p>
      </footer>
    </div>
  );
}
