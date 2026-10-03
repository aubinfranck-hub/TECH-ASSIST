import 'dotenv/config';
import { createApp } from './app.js';
import { expireOverdueSessions } from './utils/sessionClock.js';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Tech Assist API à l'écoute sur le port ${port}`);
});

// Fin des minutes du forfait : les assistances dépassées sont terminées côté serveur, même sans requête du client.
setInterval(() => {
  expireOverdueSessions().catch((err) => console.error('[sessions] nettoyage des sessions expirées en échec', err));
}, 60_000).unref();
