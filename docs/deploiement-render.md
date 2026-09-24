# Déploiement sur Render

**Statut : déployé et fonctionnel** (2026-09-24). Services créés avec
l'accord explicite de l'utilisateur, base de données réutilisée
(`ntic-shared-db`, schéma dédié `tech_assist`), migrations appliquées.

- API : [tech-assist-api](https://dashboard.render.com/web/srv-daqeq8e7bikc7388r3qg) — `https://tech-assist-api.onrender.com`
- Site : [tech-assist-web](https://dashboard.render.com/static/srv-daqeqag473hc73ft3b20) — `https://tech-assist-web.onrender.com`

## Créer le premier compte admin

Aucun compte n'existe encore. Un seul appel HTTP suffit (remplacer
`<identifiant>`, `<mot-de-passe>`, `<telephone>`, `<nom>`) :

```bash
curl -X POST https://tech-assist-api.onrender.com/api/auth/technician/bootstrap-admin \
  -H "Content-Type: application/json" \
  -d '{"fullName":"<nom>","phone":"<telephone>","username":"<identifiant>","password":"<mot-de-passe>"}'
```

Ce point d'entrée (`POST /api/auth/technician/bootstrap-admin`) ne fonctionne
qu'une seule fois : il se désactive automatiquement (409) dès qu'un compte
technicien existe. Ensuite, connexion normale sur `/technicien` ou `/admin`
avec ces identifiants.

## Ce qui a été résolu pendant le déploiement

- **Base partagée** : `ntic-shared-db` déjà utilisée par d'autres projets —
  Tech Assist isole ses 15 tables dans un schéma dédié (`tech_assist`), créé
  automatiquement par le script de migration à partir de
  `?options=-csearch_path%3Dtech_assist` dans `DATABASE_URL` (voir
  `apps/api/src/utils/dbSchema.ts`).
- **Bug de build** : `NODE_ENV=production` faisait sauter les
  `devDependencies` (TypeScript, types...) au `npm install`, empêchant la
  compilation. Corrigé avec `NPM_CONFIG_PRODUCTION=false` en variable
  d'environnement (`NODE_ENV=production` reste actif à l'exécution).
- **Pas d'accès direct** à la base ni à l'API en production depuis
  l'environnement qui a fait ce déploiement (politique réseau du bac à
  sable) — d'où le point d'amorçage HTTP ci-dessus plutôt qu'un script à
  lancer en local.

## Configuration appliquée

### Service API (`tech-assist-api`)

Web Service, runtime Node, région Frankfurt, plan free.

| Champ | Valeur |
|---|---|
| Dépôt / branche | `aubinfranck-hub/TECH-ASSIST` / `claude/ecstatic-maxwell-z0gk4g` |
| Build Command | `npm install && npm run build --workspace apps/api && npm run migrate --workspace apps/api` |
| Start Command | `npm run start --workspace apps/api` |

Variables d'environnement :

| Clé | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `NPM_CONFIG_PRODUCTION` / `NPM_CONFIG_INCLUDE` | `false` / `dev` (voir ci-dessus) |
| `JWT_SECRET`, `SESSION_SECRETS_KEY` | générés pour cette mise en prod, à ne pas réutiliser ailleurs |
| `CORS_ORIGIN` | `https://tech-assist-web.onrender.com` |
| `DATABASE_URL` | `ntic-shared-db`, schéma `tech_assist` |
| `GEMINI_API_KEY` | vide (moteur de diagnostic local utilisé à la place) |
| `RUSTDESK_ID_SERVER`, `RUSTDESK_RELAY_SERVER`, `RUSTDESK_PUBLIC_KEY` | vides tant que `infra/rustdesk/` n'est pas déployé séparément |

### Site web (`tech-assist-web`)

Static Site, build `npm install && npm run build --workspace apps/web`,
publication `apps/web/dist`, `VITE_API_BASE_URL=https://tech-assist-api.onrender.com`.

## À surveiller

- Le plan gratuit Render met le service API en veille après inactivité
  (premier appel après veille plus lent, ~30-60s) — passer sur `starter`
  avant l'ouverture publique si c'est gênant.
- Le serveur RustDesk (`infra/rustdesk/`) et les futurs clients
  Windows/Android ne sont pas concernés par ce déploiement — voir
  `docs/lot-l2-remote.md`.
- Branche déployée : `claude/ecstatic-maxwell-z0gk4g` (basculer sur `main`
  dans les paramètres du service une fois la PR fusionnée).
