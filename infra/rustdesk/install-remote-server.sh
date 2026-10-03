#!/bin/bash
# Tech Assist — installe UNIQUEMENT le serveur RustDesk (hbbs/hbbr) sur un VPS Ubuntu 24.04 vierge.
# Usage (en root, une seule commande) :
#   curl -fsSL https://raw.githubusercontent.com/aubinfranck-hub/TECH-ASSIST/claude/ecstatic-maxwell-z0gk4g/infra/rustdesk/install-remote-server.sh | bash
# À la fin, /opt/rustdesk/READ_ME.txt contient l'IP publique et la clé publique à donner à Tech Assist.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être lancé en root." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl ufw

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

PUBLIC_IP=$(curl -4 -fsS https://ifconfig.me)
mkdir -p /opt/rustdesk
cd /opt/rustdesk

cat > docker-compose.yml <<EOF
services:
  hbbs:
    container_name: hbbs
    image: rustdesk/rustdesk-server:latest
    command: hbbs -r ${PUBLIC_IP}:21117
    volumes:
      - ./data:/root
    ports:
      - "21115:21115"
      - "21116:21116/tcp"
      - "21116:21116/udp"
      - "21118:21118"
    restart: unless-stopped
    depends_on: [hbbr]
  hbbr:
    container_name: hbbr
    image: rustdesk/rustdesk-server:latest
    command: hbbr
    volumes:
      - ./data:/root
    ports:
      - "21117:21117"
      - "21119:21119"
    restart: unless-stopped
EOF

docker compose up -d

# Pare-feu : SSH + ports RustDesk uniquement.
ufw allow OpenSSH
ufw allow 21115:21119/tcp
ufw allow 21116/udp
ufw --force enable

# Attend la génération de la clé publique (jusqu'à 60 s).
for _ in $(seq 1 30); do
  [ -s data/id_ed25519.pub ] && break
  sleep 2
done

{
  echo "=== IP PUBLIQUE ==="
  echo "$PUBLIC_IP"
  echo "=== CLE PUBLIQUE RUSTDESK ==="
  cat data/id_ed25519.pub
} > READ_ME.txt

echo
cat READ_ME.txt
