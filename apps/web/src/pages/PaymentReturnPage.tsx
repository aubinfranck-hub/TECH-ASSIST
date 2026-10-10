import { Link, useSearchParams } from 'react-router-dom';

/** Page de retour après le paiement (Jèko redirige ici). La confirmation réelle vient du serveur, pas de cette page. */
export function PaymentReturnPage() {
  const [params] = useSearchParams();
  const failed = params.get('statut') === 'erreur';
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-12">
      <h1 className="font-display text-3xl font-extrabold">{failed ? 'Paiement non abouti' : 'Merci, paiement en cours de confirmation'}</h1>
      <p className="mt-4 text-slate-600">
        {failed
          ? 'Aucun montant n’a été débité si le paiement a échoué. Retournez sur Tech Assist pour réessayer ou choisir une autre méthode.'
          : 'La confirmation réelle vient du serveur. Dès que le paiement est confirmé, vous pouvez suivre votre assistance depuis le site ou l’application Tech Assist.'}
      </p>
      <Link to="/assistance" className="ta-button-primary mt-6 inline-flex">Retour à Tech Assist</Link>
    </div>
  );
}
