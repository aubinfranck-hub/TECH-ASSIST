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
          ? 'Aucun montant n’a été débité si le paiement a échoué. Retournez dans l’application Tech Assist pour réessayer ou choisir une autre méthode.'
          : 'Retournez dans l’application Tech Assist : votre assistance démarre toute seule dès que le paiement est confirmé, en général en quelques secondes.'}
      </p>
      <Link to="/telephone" className="ta-button-primary mt-6 inline-flex">Retour à l’assistant</Link>
    </div>
  );
}
