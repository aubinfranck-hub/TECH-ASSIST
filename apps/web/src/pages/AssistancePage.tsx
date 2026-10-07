import { Link } from 'react-router-dom';

export function AssistancePage() {
  return (
    <div className="ta-container max-w-4xl py-12 sm:py-16">
      <p className="ta-eyebrow">TechAssist</p>
      <h1 className="mt-2 font-display text-3xl font-extrabold sm:text-4xl">L’assistance se fait dans l’application</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
        Le site TechAssist est le portail. Le diagnostic et l’assistance réelle sont exécutés par les clients Android et Windows.
      </p>
      <section className="mt-8 grid gap-5 md:grid-cols-2">
        <article className="ta-card p-7">
          <p className="text-3xl">📱</p><h2 className="mt-3 text-2xl font-extrabold">APK Android</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">Diagnostic IA, session TechAssist, transmission du dossier au technicien et gestion de la session depuis le téléphone.</p>
          <ul className="mt-4 space-y-2 text-sm"><li>✓ Diagnostic IA</li><li>✓ Historique partagé</li><li>✓ Escalade technicien</li><li>✓ Session contrôlée par le client</li></ul>
        </article>
        <article className="ta-card p-7">
          <p className="text-3xl">💻</p><h2 className="mt-3 text-2xl font-extrabold">EXE Windows</h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">Agent installé sur le PC pour les diagnostics et l’assistance distante lorsque le client l’autorise.</p>
          <ul className="mt-4 space-y-2 text-sm"><li>✓ Diagnostic local</li><li>✓ Assistance technicien</li><li>✓ RustDesk lorsque nécessaire</li><li>✓ Consentement du client</li></ul>
        </article>
      </section>
      <section className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-6">
        <p className="font-bold text-green-900">🎉 Lancement gratuit</p>
        <p className="mt-1 text-sm text-green-800"><s>500 FCFA</s> Assistance IA · <s>2 000 FCFA</s> IA + technicien · gratuit actuellement.</p>
      </section>
      <section className="mt-8 ta-card p-7">
        <h2 className="text-xl font-extrabold">Parcours réel</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-5 text-center text-sm font-semibold">
          <div className="rounded-xl bg-slate-50 p-4">1. Installer</div><div className="rounded-xl bg-slate-50 p-4">2. Diagnostiquer</div><div className="rounded-xl bg-slate-50 p-4">3. IA</div><div className="rounded-xl bg-slate-50 p-4">4. Technicien</div><div className="rounded-xl bg-slate-50 p-4">5. Résoudre</div>
        </div>
      </section>
      <div className="mt-8"><Link to="/demander-aide" className="ta-button-primary">🆘 Accéder aux applications</Link></div>
    </div>
  );
}
