# Bibliothèque Tech Assist

Cette bibliothèque rassemble les créations intégrées au produit Tech Assist.
Elle permet de retrouver rapidement chaque module, son code source, sa finalité
et sa documentation. Elle décrit le socle de production consolidé dans cette
branche ; les brouillons isolés ne sont pas présentés comme des fonctionnalités
validées.

## Carte du produit

| Domaine | Produit | Sources principales | Rôle |
|---|---|---|---|
| Client Windows | Agent Tech Assist | `apps/agent` | Diagnostic, maintenance, réparation guidée, formation et relais humain. |
| Client Android | Application Tech Assist | `apps/android` | Demande d'assistance, chat, suivi et accès distant avec consentement. |
| Web | Portail Tech Assist | `apps/web` | Présentation, téléchargement, commande et espaces client, technicien, partenaire, entreprise et administration. |
| Serveur | API Tech Assist | `apps/api` | Authentification, sessions, paiements, IA, données, notifications et audit. |
| Assistance distante | RustDesk | `infra/rustdesk`, `apps/api/src/routes/remote.ts` | Appairage, chiffrement des identifiants et serveur distant auto-hébergé. |
| Déploiement | Infrastructure | `infra/hetzner`, `.github/workflows` | Images, déploiement, publication des exécutables et APK. |

## Modules fonctionnels

### Assistance et support

- **Sessions assistées** : création, code de session, file d'attente,
  consentement, minuteur, clôture et journal d'audit.
- **Assistance à distance** : RustDesk est téléchargé avec une empreinte
  SHA-256 vérifiée ; les identifiants sont chiffrés au repos et visibles au seul
  technicien assigné après consentement.
- **Chat et relais humain** : conversation client-technicien, escalade de
  l'agent et suivi de progression.

Références : `apps/api/src/routes/sessions.ts`,
`apps/api/src/routes/remote.ts`, `apps/agent/src/humanRelay.ts`.

### Agent Windows

- **Maintenance et réparation** : disque, nettoyage, performances, démarrage,
  réseau, son, imprimante, sécurité, pilotes, services, batterie et réparation
  Windows.
- **Garde-fous** : analyse avant action, explication, accord explicite,
  point de restauration pour les opérations sensibles, relecture et rapport.
- **Formation et aide applicative** : parcours de formation, Office,
  Microsoft 365 et assistance conversationnelle.
- **Distribution** : empaquetage Windows, mise à jour et outils technicien.

Références : `apps/agent/src/agent.ts`, `apps/agent/src/skills/`,
`docs/agent.md`.

### IA et apprentissage

- Diagnostic local avec recours configurable à Gemini.
- Assistant conversationnel avec chaîne de fournisseurs DeepSeek, Gemini et
  Claude, sans divulgation des secrets.
- Base de connaissances, procédures, retours de résolution et apprentissage
  encadré côté serveur.

Références : `apps/api/src/diagnostics/`, `apps/api/src/assistant/`,
`apps/api/src/learning/`.

### Comptes, accès et conformité

- Comptes technicien, administrateur, partenaire et entreprise.
- Connexion, limitation des tentatives, TOTP/2FA et séparation des jetons
  client, technicien et entreprise.
- Vérification e-mail, rôles, journal d'audit et notifications.

Références : `apps/api/src/routes/technicianAuth.ts`,
`apps/api/src/middleware/`, `apps/api/src/utils/audit.ts`.

### Commerce et partenaires

- Tarification, offres IA/humain/hybride, abonnement et première assistance.
- Commandes, paiements Mobile Money et webhook signé lorsque le prestataire
  est configuré.
- Partenaires, interventions, rémunération et suivi commercial.

Références : `apps/api/src/routes/orders.ts`, `apps/api/src/payments/`,
`apps/api/src/partners/`, `apps/web/src/pages/`.

## Règles de consolidation

1. `main` est la branche de référence pour les déploiements.
2. Une création passe par une branche de fonctionnalité, des tests et une pull
   request avant sa fusion dans `main`.
3. Toute fonctionnalité livrée doit être ajoutée à cette bibliothèque avec ses
   sources, son statut et ses limites.
4. Les fonctionnalités expérimentales restent documentées comme telles et ne
   sont pas activées en production sans validation.

## Vérification locale

```bash
npm install
npm run build
npm test
```

Les tests d'intégration API nécessitent une instance PostgreSQL de test et les
variables d'environnement décrites dans `.env.example`.
