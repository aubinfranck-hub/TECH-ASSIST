import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL manquant (voir .env.example)');
}

// connectionTimeoutMillis : une saturation du pool doit produire une erreur, pas un blocage de toute l'API.
export const pool = new Pool({ connectionString, connectionTimeoutMillis: 10_000 });

// Sans ce gestionnaire, une erreur sur un client inactif du pool (déconnexion
// réseau, erreur protocole...) remonte comme événement 'error' non écouté et
// fait planter tout le processus Node — un seul incident DB couperait l'API
// pour tous les utilisateurs. On journalise et on laisse le pool se rétablir.
pool.on('error', (err) => {
  console.error('Erreur inattendue sur une connexion PostgreSQL inactive :', err);
});
