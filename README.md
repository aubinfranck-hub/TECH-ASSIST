# Tech Assist

Plateforme d'assistance informatique à distance pour particuliers et PME
(Côte d'Ivoire) : diagnostic IA, commande et paiement Mobile Money, sessions
assistées avec un technicien, console technicien et administration.

Ce dépôt contient le **Lot L1 — le portail** : site public, API et base de
données. Le contrôle à distance effectif (partage d'écran/contrôle réel via
WebRTC, clients Windows/Android) est un lot ultérieur (L2/L3) : les sessions
créées ici gèrent déjà le code d'appairage, le consentement en deux étapes,
le minuteur et l'arrêt immédiat, mais le flux vidéo lui-même reste à
brancher.

## Structure

```
apps/api   API Node.js/Express + TypeScript, PostgreSQL
apps/web   Site React + TypeScript + Vite + Tailwind
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

## Ce qui reste (lots suivants, voir cahier des charges)

- L2 : service Remote (flux WebRTC + TURN, injection souris/clavier réelle,
  client Windows).
- L3 : client Android signé (partage d'écran, guidage, puis contrôle par
  accessibilité).
- L4 : paiement Mobile Money automatisé (webhook signé) — décision D3.
- Espace entreprise PME complet (agent permanent, RP-01 à RP-09) et 2FA
  technicien (RS-08).
- Bêta fermée, CGU et déclaration ARTCI avant ouverture publique.

Les points laissés en suspens dans le code sont balisés
`// TA[DECIDER][...]` ou `// TA[MANQUANT][...]`, suivant la convention du
cahier des charges.
