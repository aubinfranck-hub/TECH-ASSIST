# Tech Assist — déploiement Hetzner

Cette configuration permet de sortir Tech Assist de Render tout en gardant GitHub comme source du code.

Services : Caddy (HTTP, ou HTTPS automatique dès qu'un domaine est configuré), React/Nginx, Node/Express, PostgreSQL privé, RustDesk hbbs/hbbr.

## Sans nom de domaine (démarrage immédiat)

Pré-requis :
- VM Hetzner Cloud Ubuntu 24.04
- ouvrir 80, 21115-21119/tcp et 21116/udp dans le pare-feu Hetzner
- ne jamais exposer PostgreSQL 5432 publiquement

Installation (voir `cloud-init.yaml` pour un amorçage automatique complet à la création
de la VM, sans connexion SSH manuelle) :
1. `git clone -b claude/ecstatic-maxwell-z0gk4g https://github.com/aubinfranck-hub/TECH-ASSIST.git`
2. `cd TECH-ASSIST`
3. `cp infra/hetzner/.env.example infra/hetzner/.env`
4. Renseigner les secrets dans `infra/hetzner/.env` (mots de passe/clés générés,
   `RUSTDESK_ID_SERVER`/`RUSTDESK_RELAY_SERVER`/`RUSTDESK_RELAY_HOST` = IP publique du serveur)
5. `docker compose --env-file infra/hetzner/.env -f infra/hetzner/docker-compose.yml up -d --build`

Vérifications :
```
docker compose --env-file infra/hetzner/.env -f infra/hetzner/docker-compose.yml ps
curl -I http://<IP_DU_SERVEUR>
curl http://<IP_DU_SERVEUR>/api/health
```

## Une fois un nom de domaine disponible

1. Pointer les DNS (`A` records) du domaine et `remote.<domaine>` vers l'IP du serveur.
2. Remplacer le bloc `:80` de `Caddyfile` par le bloc commenté à l'intérieur (avec le
   vrai nom de domaine) — Caddy demandera alors seul un certificat Let's Encrypt.
3. Mettre à jour `CORS_ORIGIN`, `RUSTDESK_ID_SERVER`, `RUSTDESK_RELAY_SERVER`,
   `RUSTDESK_RELAY_HOST` dans `.env` avec le domaine.
4. `docker compose --env-file infra/hetzner/.env -f infra/hetzner/docker-compose.yml up -d --build`

## Avant de couper Render

Sauvegarder/restaurer les données PostgreSQL (voir `seed-from-render.sql` si présent),
tester authentification, commandes, sessions, paiements, diagnostic et RustDesk sur le
nouveau serveur avant de couper Render — le garder actif en parallèle permet un retour
en arrière si besoin.
