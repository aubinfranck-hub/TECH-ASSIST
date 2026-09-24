#!/bin/bash
set -euo pipefail

curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

PUBLIC_IP=$(curl -s https://ifconfig.me)

git clone -b claude/ecstatic-maxwell-z0gk4g https://github.com/aubinfranck-hub/TECH-ASSIST.git /opt/tech-assist
cd /opt/tech-assist

POSTGRES_PASSWORD=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
JWT_SECRET=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)
SESSION_SECRETS_KEY=$(openssl rand -base64 32)

cat > infra/hetzner/.env <<EOF
POSTGRES_DB=techassist
POSTGRES_USER=techassist
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
SESSION_SECRETS_KEY=$SESSION_SECRETS_KEY
GEMINI_API_KEY=
CORS_ORIGIN=*
RUSTDESK_ID_SERVER=$PUBLIC_IP
RUSTDESK_RELAY_SERVER=$PUBLIC_IP
RUSTDESK_RELAY_HOST=$PUBLIC_IP
RUSTDESK_PUBLIC_KEY=
EOF

docker compose --env-file infra/hetzner/.env -f infra/hetzner/docker-compose.yml up -d --build

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 21115:21119/tcp
ufw allow 21116/udp
ufw --force enable

sleep 15
{
  echo "=== IP PUBLIQUE ==="
  echo "$PUBLIC_IP"
  echo "=== CLE PUBLIQUE RUSTDESK ==="
  docker exec tech-assist-hbbs cat /root/id_ed25519.pub
} > /opt/tech-assist/READ_ME.txt
