# Tech Assist

Plateforme d'assistance informatique à distance pour particuliers et PME
(Côte d'Ivoire) : diagnostic IA, commande et paiement Mobile Money, sessions
assistées avec un technicien, console technicien et administration.

Ce dépôt regroupe le portail, l'API, l'agent Windows et l'application Android.
L'assistance à distance s'appuie sur RustDesk auto-hébergé (décision D1) plutôt
que de réinventer WebRTC, la capture d'écran et l'injection d'entrées. Le
parcours d'appairage (code de session, consentement, identifiants chiffrés) est
implémenté.

La [bibliothèque Tech Assist](docs/bibliotheque/README.md) est le point d'entrée
pour découvrir les modules livrés, leur rôle, leur statut et les documents de
référence.

## Structure

```
apps/api        API Node.js/Express + TypeScript, PostgreSQL
apps/web        Site React + TypeScript + Vite + Tailwind
apps/agent      Agent Windows local de diagnostic, réparation et formation
apps/android    Application Android native client / technicien
infra/rustdesk  Docker Compose du serveur RustDesk auto-hébergé (Lot L2)
docs/           Notes d'architecture par lot
```

## Démarrage local

Prérequis : Node.js 20+, PostgreSQL.

```bash
npm install

# Base de données
createdb tech_assist
cp .env.example apps/api/.env   # renseigner DATABASE_URL, JWT_SECRET, etc.
npm run migrate

# Créer un compte administrateur (mot de passe affiché une seule fois)
npm run seed:admin --workspace apps/api -- <identifiant> <telephone>

# Lancer l'API et le site (deux terminaux)
npm run dev:api
npm run dev:web
```

Le site attend l'API sur `VITE_API_BASE_URL` (voir `apps/web/.env`, défaut
`http://localhost:4000`).

## Tests

```bash
npm run test --workspace apps/api
```

Les tests d'intégration utilisent une base PostgreSQL dédiée
(`DATABASE_URL` pointant vers une base de test, migrée au préalable).

## Produits inclus

- **Portail web** : présentation, commande, espace client, console technicien,
  administration, partenaires et entreprises.
- **Agent Windows** : diagnostic, maintenance guidée, réparation avec accord,
  chat local, formation et passage de main à un technicien.
- **Application Android** : création et suivi d'assistance, chat et contrôle
  d'accès à distance avec consentement.
- **API** : sessions, paiements, comptes, abonnement, IA, notifications,
  audit et intégration RustDesk.

Consultez la [bibliothèque fonctionnelle](docs/bibliotheque/README.md) pour le
catalogue détaillé et les limites connues.

## Ce qui est fait (Lot L1)

- Accueil Particuliers/PME, tarifs (lus en base, RF-41), FAQ, parcours en 3 étapes.
- Commande sans compte lourd (téléphone) et confirmation de paiement
  manuelle par un technicien — en attendant le choix d'un agrégateur Mobile
  Money (décision D3, voir `// TA[DECIDER][D3]` dans le code).
- Diagnostic IA (Gemini si `GEMINI_API_KEY` est configurée, sinon moteur de
  secours local honnête sur la confiance) — débloqué uniquement après
  paiement.
- Sessions : code à usage unique expirant en 10 min (RS-03), consentement en
  deux étapes (RS-01), minuteur, arrêt immédiat (RS-02).
- Console technicien (comptes nominatifs, file d'attente, confirmation de
  paiement) et administration (tarifs, candidatures techniciens, demandes
  PME/visites, journal d'audit).
- Sécurité de base : Helmet, CORS, rate-limiting, validation stricte (zod),
  secrets hors dépôt.

## Ce qui est fait (début du Lot L2)

- Décision D1 tranchée : RustDesk auto-hébergé (`infra/rustdesk/`) plutôt
  qu'un développement maison de WebRTC/capture d'écran/injection d'entrées.
- Appairage session ↔ RustDesk : le client saisit son ID/mot de passe
  RustDesk, chiffrés au repos (RS-10) et purgés à l'arrêt de la session.
- Les identifiants de connexion ne sont révélés au technicien qu'après prise
  en charge de la session ET consentement contrôle explicite du client.
- Détails, limites et prochaines étapes : `docs/lot-l2-remote.md`.

## Ce qui reste (lots suivants, voir cahier des charges)

- L2 : client Windows RustDesk personnalisé et signé (actuellement : client
  portable officiel + configuration manuelle par le client).
- L3 : client Android signé (partage d'écran, guidage, puis contrôle par
  accessibilité).
- L4 : paiement Mobile Money automatisé (webhook signé) — décision D3.
- Espace entreprise PME complet (agent permanent, RP-01 à RP-09) et 2FA
  technicien (RS-08).
- Bêta fermée, CGU et déclaration ARTCI avant ouverture publique.

Les points laissés en suspens dans le code sont balisés
`// TA[DECIDER][...]` ou `// TA[MANQUANT][...]`, suivant la convention du
cahier des charges.
