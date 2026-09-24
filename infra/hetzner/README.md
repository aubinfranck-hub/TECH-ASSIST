# Tech Assist — déploiement Hetzner

Cette configuration permet de sortir Tech Assist de Render tout en gardant GitHub comme source du code.

Services : Caddy HTTPS, React/Nginx, Node/Express, PostgreSQL privé, RustDesk hbbs/hbbr.

Pré-requis :
- VM Hetzner Cloud Ubuntu 24.04
- DNS techassist.ci et www.techassist.ci vers l'IP de la VM
- DNS remote.techassist.ci vers l'IP de la VM
- ouvrir 80/443 et les ports RustDesk 21115-21119 selon le protocole
- ne jamais exposer PostgreSQL 5432

Installation :
1. git clone -b claude/ecstatic-maxwell-z0gk4g https://github.com/aubinfranck-hub/TECH-ASSIST.git
2. cd TECH-ASSIST
3. cp infra/hetzner/.env.example infra/hetzner/.env
4. renseigner les secrets dans infra/hetzner/.env
5. docker compose --env-file infra/hetzner/.env -f infra/hetzner/docker-compose.yml up -d --build

Vérifications :
docker compose --env-file infra/hetzner/.env -f infra/hetzner/docker-compose.yml ps
curl -I https://techassist.ci
curl https://techassist.ci/api/health

Avant de supprimer Render : sauvegarder/restaurer PostgreSQL, tester authentification, commandes, sessions, paiements, diagnostic et RustDesk, puis basculer le DNS. Garder Render actif pendant le basculement pour permettre un rollback.
