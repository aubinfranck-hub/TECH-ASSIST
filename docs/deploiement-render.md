# Déploiement sur Render

Les services sont créés (avec ton accord explicite du 2026-09-24) :

- API : [tech-assist-api](https://dashboard.render.com/web/srv-daqeq8e7bikc7388r3qg) — `https://tech-assist-api.onrender.com`
- Site : [tech-assist-web](https://dashboard.render.com/static/srv-daqeqag473hc73ft3b20) — `https://tech-assist-web.onrender.com`

**Il manque une seule chose, que je ne peux pas récupérer moi-même** : le
mot de passe de connexion à `ntic-shared-db` (non exposé par les outils
Render dont je dispose, à raison). Sans lui, le déploiement de l'API échoue
au moment des migrations (`DATABASE_URL` est encore un placeholder).

## À faire pour finaliser (5 minutes)

1. Dashboard Render → `ntic-shared-db` → onglet **Connect** → copier
   **External Database URL**.
2. Y ajouter `?options=-csearch_path%3Dtech_assist` à la fin, pour isoler
   les tables de Tech Assist dans leur propre schéma au sein de la base
   partagée, par exemple :
   `postgres://user:pass@host/ntic_shared_db?options=-csearch_path%3Dtech_assist`
3. Créer le schéma une fois (dashboard Render → `ntic-shared-db` → onglet
   **Shell**, ou `psql` avec l'URL ci-dessus sans l'option search_path) :
   ```sql
   CREATE SCHEMA IF NOT EXISTS tech_assist;
   ```
4. Dashboard → `tech-assist-api` → **Environment** → remplacer `DATABASE_URL`
   (actuellement `REMPLACER_PAR_LA_CHAINE_DE_CONNEXION_NTIC_SHARED_DB`) par
   l'URL de l'étape 2. Ça déclenche automatiquement un nouveau déploiement,
   qui exécutera les migrations.

## Configuration appliquée

### Service API (`tech-assist-api`)

Web Service, runtime Node, région Frankfurt, plan free.

| Champ | Valeur |
|---|---|
| Dépôt / branche | `aubinfranck-hub/TECH-ASSIST` / `claude/ecstatic-maxwell-z0gk4g` |
| Build Command | `npm install && npm run build --workspace apps/api && npm run migrate --workspace apps/api` |
| Start Command | `npm run start --workspace apps/api` |

Variables d'environnement déjà posées :

| Clé | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | généré pour cette mise en prod (ne pas réutiliser ailleurs) |
| `SESSION_SECRETS_KEY` | généré pour cette mise en prod |
| `CORS_ORIGIN` | `https://tech-assist-web.onrender.com` |
| `DATABASE_URL` | **à remplacer, voir ci-dessus** |
| `GEMINI_API_KEY` | vide (moteur de diagnostic local utilisé à la place) |
| `RUSTDESK_ID_SERVER`, `RUSTDESK_RELAY_SERVER`, `RUSTDESK_PUBLIC_KEY` | vides tant que `infra/rustdesk/` n'est pas déployé séparément |

### Site web (`tech-assist-web`)

Static Site, build `npm install && npm run build --workspace apps/web`,
publication `apps/web/dist`, `VITE_API_BASE_URL=https://tech-assist-api.onrender.com`.

## Après que l'API démarre pour de bon

1. Créer un compte admin : depuis un poste avec `DATABASE_URL` de prod en
   variable d'env, `npm run seed:admin --workspace apps/api -- <identifiant> <telephone>`.
   Le mot de passe n'est affiché qu'une fois — le noter en lieu sûr.
2. Vérifier `GET https://tech-assist-api.onrender.com/api/health` →
   `{"status":"ok","db":"ok"}`.
3. Le plan gratuit Render met le service en veille après inactivité (premier
   appel après veille plus lent) — passer sur `starter` avant l'ouverture
   publique si c'est gênant.
4. Le serveur RustDesk (`infra/rustdesk/`) et les futurs déploiements du
   client Windows/Android ne sont pas concernés par ce déploiement — voir
   `docs/lot-l2-remote.md`.
