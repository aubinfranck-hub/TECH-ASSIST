# Lot L2 — service Remote (contrôle à distance)

## Décision D1 : base ouverte auto-hébergée (RustDesk)

Plutôt que de réinventer WebRTC, la capture d'écran et l'injection
souris/clavier (des mois de travail et des bugs bas niveau), Tech Assist
s'appuie sur **RustDesk**, un outil de prise en main à distance open source
(GPLv3) auto-hébergeable :

- `hbbs` (RustDesk ID/Rendezvous server) : appairage entre client et
  technicien.
- `hbbr` (RustDesk relay server) : relais du flux quand la connexion directe
  échoue (NAT strict, réseaux mobiles ivoiriens — cf. RN-01 à RN-03).

Tech Assist reste propriétaire de tout ce qui est métier (portail, paiement,
comptes, minuteur, consentement, journal d'audit) ; RustDesk ne gère que le
flux écran/contrôle lui-même. Le serveur RustDesk lui-même ne voit passer
aucune donnée métier — uniquement le flux vidéo/contrôle chiffré.

## Architecture

```
Client (navigateur)              Technicien (console web)
      |                                  |
      v                                  v
   Portail Tech Assist  <——— API/BDD ———>  Portail Tech Assist
   (commande, paiement, code de session, consentement, minuteur)
      |                                  |
      v (configure + lance)              v (saisit les identifiants reçus)
  Client RustDesk portable  <——— hbbs/hbbr auto-hébergé ———>  Client RustDesk du technicien
```

Le code de session Tech Assist (9 chiffres, RS-03) et l'ID/mot de passe
RustDesk sont deux choses distinctes, reliées par la table `sessions` :

- `remote_peer_id` : ID RustDesk du client, transmis une fois son outil lancé.
- `remote_password_encrypted` : mot de passe de connexion temporaire, chiffré
  au repos (AES-256-GCM, RS-10) et **purgé automatiquement à l'arrêt de la
  session**.
- Le technicien ne peut lire ces identifiants qu'une fois **assigné à la
  session** ET après le **consentement contrôle explicite du client**
  (`consent_control_at`) — voir `apps/api/src/routes/remote.ts`.

## Déploiement du serveur RustDesk

Voir `infra/rustdesk/docker-compose.yml` (repris du docker-compose officiel
du projet, github.com/rustdesk/rustdesk-server).

```bash
cd infra/rustdesk
RUSTDESK_RELAY_HOST=remote.techassist.ci docker compose up -d
```

Ports à ouvrir sur le serveur : `21115/tcp`, `21116/tcp+udp`, `21118/tcp`
(hbbs), `21117/tcp`, `21119/tcp` (hbbr).

Au premier démarrage, `hbbs` génère une paire de clés dans `./data/` :
`id_ed25519` (privée, ne jamais exposer) et `id_ed25519.pub` (publique).
Configurer l'API Tech Assist avec :

```
RUSTDESK_ID_SERVER=remote.techassist.ci
RUSTDESK_RELAY_SERVER=remote.techassist.ci
RUSTDESK_PUBLIC_KEY=<contenu de data/id_ed25519.pub>
```

**Sauvegarder `./data/id_ed25519*` en lieu sûr** : le perdre invalide
l'appairage de tous les clients déjà en circulation.

## Parcours V1 (implémenté)

1. Le client obtient une session payée (code à 9 chiffres) comme avant.
2. Sur la page de session, Tech Assist affiche les paramètres réseau du
   serveur RustDesk (ID/relais/clé) et un lien vers le client RustDesk
   **portable officiel**.
3. Le client lance l'outil, le configure avec ces paramètres (Réseau), note
   son ID et un mot de passe temporaire, puis les saisit sur la page de
   session → `POST /api/sessions/:id/pair`.
4. Un technicien prend la session en charge, le client consent (écran puis
   contrôle), puis le technicien récupère les identifiants
   (`GET /api/technician/sessions/:id/remote-credentials`) et se connecte
   avec son propre client RustDesk.

C'est un parcours honnête et fonctionnel, mais avec une étape manuelle
(configuration réseau + copie d'ID/mot de passe) qui n'est pas encore au
niveau "sans réglage" attendu par RF-10.

## Distribution : miroir du client officiel

`.github/workflows/mirror-rustdesk-client.yml` republie chaque semaine (ou à
la demande) la dernière release officielle de RustDesk (Windows + Android)
comme release de ce dépôt, avec empreinte SHA-256, et met à jour
`apps/web/public/downloads-manifest.json`. Le portail affiche alors un lien
de téléchargement sur notre propre domaine plutôt que vers GitHub
directement, avec l'empreinte visible — ce que demande le cahier des charges
en section Distribution, sans attendre le client personnalisé.

`.github/workflows/build-custom-client.yml` est un squelette documenté (non
fonctionnel) pour le futur client Windows personnalisé et signé — voir les
`TODO` dans le fichier pour ce qu'il reste à faire (toolchain Rust/Flutter,
injection de la config serveur au build, certificat de signature de code).

Aucun des deux workflows n'a été exécuté ni vérifié depuis cet environnement
(pas d'accès à GitHub Actions ici) : à tester au premier déclenchement
manuel après le push.

## Ce qui reste (au-delà de ce lot)

- **Client Windows sur mesure** (RF-10, RF-15) : construire un client
  RustDesk portable pré-configuré (serveur + clé déjà intégrés, mot de passe
  à usage unique généré par notre serveur au téléchargement) via le système
  de personnalisation client de RustDesk. Nécessite un pipeline de build
  Windows/Rust et, pour éviter l'avertissement SmartScreen, un certificat de
  signature de code (OV/EV) — aucun des deux n'est disponible dans cet
  environnement de développement.
- **Client Android** (Lot L3) : RustDesk propose aussi un client Android,
  mais son mode contrôle par accessibilité doit être validé séparément
  (permissions système, marques agressives sur le kill des apps en fond).
- Appairage encore manuel : automatiser en pilotant le client via ligne de
  commande (le client RustDesk accepte des arguments `--password` /
  fichier de config) pour éliminer la copie manuelle de l'ID/mot de passe.
- TURN/relais dédié dimensionné pour la charge réelle, mesure de latence
  Abidjan (RN-01, RN-02).
