# Déploiement sur Render

Le déploiement réel n'a pas pu être fait automatiquement : la création de
services de production a été bloquée par une protection du mode automatique
qui exige une confirmation explicite (et à raison — ça crée de vraies
ressources facturables sur ton compte). Voici la configuration exacte prête
à appliquer, soit par toi-même depuis le dashboard Render, soit en me
redonnant le feu vert pour le faire.

## Base de données

Décision prise : réutiliser **ntic-shared-db** (Frankfurt, plan 0.1c-256mb)
plutôt que créer une nouvelle base (une seule base gratuite est autorisée
par compte, et elle est déjà prise par `juriscoach-db`).

Tech Assist utilisera un schéma dédié (`tech_assist`) dans cette base
partagée pour ne pas mélanger ses tables avec celles des autres projets.

**Ce que je ne peux pas récupérer moi-même** : le mot de passe de connexion
(non exposé par les outils Render dont je dispose, à raison). À copier
depuis le dashboard :

1. Dashboard Render → `ntic-shared-db` → onglet **Connect** → copier
   **External Database URL**.
2. L'ajouter comme variable d'environnement `DATABASE_URL` sur le service
   `tech-assist-api` (voir ci-dessous). Ajouter `?options=-csearch_path%3Dtech_assist`
   à la fin de l'URL pour isoler les tables dans leur propre schéma, par
   exemple :
   `postgres://user:pass@host/ntic_shared_db?options=-csearch_path%3Dtech_assist`
3. Créer le schéma une fois, avant le premier déploiement (SQL à lancer
   depuis le dashboard Render, onglet **Shell**, ou avec `psql`) :
   ```sql
   CREATE SCHEMA IF NOT EXISTS tech_assist;
   ```

## Service API (`tech-assist-api`)

Web Service, runtime Node, région Frankfurt (comme demandé dans le cahier
des charges), plan free pour démarrer.

| Champ | Valeur |
|---|---|
| Dépôt | `https://github.com/aubinfranck-hub/TECH-ASSIST` |
| Branche | `claude/ecstatic-maxwell-z0gk4g` (à basculer sur `main` une fois la PR fusionnée) |
| Build Command | `npm install && npm run build --workspace apps/api && npm run migrate --workspace apps/api` |
| Start Command | `npm run start --workspace apps/api` |

Variables d'environnement :

| Clé | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `7tmzGRhh_qCwv89Dbov8oYZeCR6_iY9t1QFkDERWIHM` (généré pour cette mise en prod — à ne pas réutiliser ailleurs) |
| `SESSION_SECRETS_KEY` | `8Ky0/snSIqrts8VIglsvSwLVvqVPcD11ZFCPZKpqht4=` |
| `DATABASE_URL` | (voir section Base de données ci-dessus) |
| `CORS_ORIGIN` | URL du site une fois créé (ex: `https://tech-assist-web.onrender.com`) |
| `GEMINI_API_KEY` | vide, ou ta clé si tu veux activer le diagnostic IA (sinon moteur de secours local) |
| `RUSTDESK_ID_SERVER`, `RUSTDESK_RELAY_SERVER`, `RUSTDESK_PUBLIC_KEY` | vides tant que le serveur RustDesk (`infra/rustdesk/`) n'est pas déployé séparément |

Le build exécute les migrations à chaque déploiement (idempotent, sans
risque à rejouer).

## Site web (`tech-assist-web`)

Static Site.

| Champ | Valeur |
|---|---|
| Dépôt | même dépôt, même branche |
| Build Command | `npm install && npm run build --workspace apps/web` |
| Publish Path | `apps/web/dist` |

Variable d'environnement (nécessaire **au moment du build**, donc à créer le
service API d'abord pour connaître son URL) :

| Clé | Valeur |
|---|---|
| `VITE_API_BASE_URL` | URL du service API (ex: `https://tech-assist-api.onrender.com`) |

Une fois le site créé, revenir sur `tech-assist-api` et mettre à jour
`CORS_ORIGIN` avec l'URL réelle du site (déclenche un redéploiement
automatique).

## Après le premier déploiement

1. Créer un compte admin : depuis un shell local pointant sur la base de
   prod (`DATABASE_URL` en variable d'env), `npm run seed:admin --workspace apps/api -- <identifiant> <telephone>`.
   Le mot de passe n'est affiché qu'une fois — le noter en lieu sûr.
2. Vérifier `GET https://tech-assist-api.onrender.com/api/health` → `{"status":"ok","db":"ok"}`.
3. Le plan gratuit Render met le service en veille après inactivité (premier
   appel après veille plus lent) — passer sur `starter` avant l'ouverture
   publique si c'est gênant.
