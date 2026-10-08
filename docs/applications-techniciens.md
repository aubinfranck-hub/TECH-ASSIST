# Applications technicien (Windows et Android) — architecture et état

## Principe

Comme AnyDesk ou TeamViewer : **tout se passe dans les applications**. Le site n'est qu'une vitrine (information + téléchargement + « suivre ma demande »).

| Qui | Windows | Android |
|---|---|---|
| Client | `tech-assist-agent.exe` (IA + réparations + numéro d'aide) | `tech-assist-android.apk` (conseils de l'IA + technicien) |
| Technicien | `tech-assist-technicien.exe` | `tech-assist-technicien.apk` |

Téléchargements (adresses fixes) : `releases/download/agent-latest/…` (Windows), `releases/download/android-latest/…` (Android).

## Alerte « ding-dong » : tous les techniciens en même temps

1. Un client demande un technicien (bouton ou passage de main de l'IA) → `alertTechnicians()` (serveur) : web push, e-mail, webhook **et** flux temps réel.
2. `GET /api/technician/stream` (SSE, en-tête `Authorization`) : chaque application technicien garde UNE connexion ouverte et reçoit
   `request` (nouvelle demande, au même instant pour tous les techniciens de permanence), `taken` (un confrère l'a prise : retirer l'alerte),
   `snapshot` (file complète à la connexion puis toutes les 30 s : rattrape une coupure), `ping` (toutes les 15 s).
3. Premier arrivé, premier servi : `PATCH /technician/sessions/:id/claim` est atomique (409 pour le second).

## Connexion des applications

Mot de passe (+ code 2FA) dans la console, puis **jeton d'appareil** de 30 jours (`POST /api/auth/technician/device-token`) :
lié à l'appareil, révocable (`DELETE /api/auth/technician/devices/:id`), revérifié en base à chaque requête (appareil révoqué ou technicien
désactivé = refus immédiat), ne peut pas en fabriquer un autre, 10 appareils actifs au plus.

## Application Windows technicien

Fenêtre Edge/Chrome dédiée (profil persistant : connexion gardée) sur la console en mode application (`?app=1`), avec
`--autoplay-policy=no-user-gesture-required` (le ding-dong sonne sans clic, même fenêtre réduite) et sans mise en veille de la fenêtre.
Démarre avec Windows (clé `Run`, fenêtre réduite), un seul exemplaire (verrou local), mise à jour automatique (`latest.json`).
Fermer la fenêtre = se mettre hors ligne ; il suffit de la réduire pour rester en alerte.

## Application Android technicien

`apps/android-technicien` : service au premier plan (`specialUse`) relié au flux, notification sonore (canal « Demandes de clients », `dingdong.wav`),
re-sonnerie chaque minute tant qu'une demande attend, reprise au démarrage du téléphone, console en WebView, bouton RustDesk.

## Ce qui est vérifié automatiquement (sans vous)

- **API** : 14 essais d'intégration sur un vrai serveur HTTP (jeton d'appareil, révocation, flux, « premier arrivé », file à la connexion).
- **Console** : navigateur réel contre la vraie API — demande visible chez 2 techniciens en ~200 ms, ding-dong chez les deux, retrait chez l'autre à la prise.
- **Windows (fabrication, vrai Windows)** : auto-contrôle, clé de démarrage relue, un seul exemplaire, **vraie fenêtre Edge** qui mesure
  « mode application » et « son autorisé sans clic ».
- **Android (fabrication)** : essais Kotlin (flux, reconnexion, silence, 401, logique d'alerte) + contrôle de l'APK (nom, version, droits, service).
  Le même code Kotlin a aussi reçu une vraie demande de la vraie API.

## Ce qui ne l'est PAS (honnêteté)

- L'APK n'a pas tourné sur un téléphone ou un émulateur : l'affichage des notifications, le comportement du service écran éteint, et les
  réglages d'économie de batterie propres à chaque marque (Tecno, Infinix, Xiaomi…) restent à constater sur un vrai téléphone.
- Sans notification poussée Google (FCM), la garantie de sonnerie écran éteint dépend de l'autorisation « rester actif en arrière-plan ».
- Signature Android stable : voir `apps/android-technicien/README.md` (secrets GitHub à créer une fois).
- Serveur VPS (RustDesk) : l'espace technicien affiche maintenant son état vu depuis le serveur de l'application (`/api/technician/remote-status`).

## Variables d'environnement utiles (Render)

`DEEPSEEK_API_KEY` (IA du chat, essayée en premier), `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `CHAT_PROVIDERS` (ordre, défaut `deepseek,gemini,claude`),
`RUSTDESK_ID_SERVER` / `RUSTDESK_RELAY_SERVER` / `RUSTDESK_PUBLIC_KEY` (serveur privé du VPS).
