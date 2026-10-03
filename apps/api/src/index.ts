import 'dotenv/config';
import { createApp } from './app.js';
import { expireOverdueSessions } from './utils/sessionClock.js';

const jwtSecret = process.env.JWT_SECRET ?? '';
if (process.env.NODE_ENV === 'production' && (jwtSecret.length < 24 || /change-me|secret|password/i.test(jwtSecret))) {
  console.error('[sécurité] JWT_SECRET est absent ou faible : définissez une valeur aléatoire d’au moins 24 caractères.');
}

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Tech Assist API à l'écoute sur le port ${port}`);
});

// Fin des minutes du forfait : les assistances dépassées sont terminées côté serveur, même sans requête du client.
setInterval(() => {
  expireOverdueSessions().catch((err) => console.error('[sessions] nettoyage des sessions expirées en échec', err));
}, 60_000).unref();
