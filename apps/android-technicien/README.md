# Tech Assist Technicien (Android)

Application des techniciens. Elle fait deux choses :

1. **Alerte en direct** : un service au premier plan garde une connexion ouverte avec le serveur (`GET /api/technician/stream`) et fait sonner
   un « ding-dong » dès qu'un client demande un technicien — au même instant pour tous les techniciens de permanence. La demande re-sonne
   chaque minute tant qu'elle attend, et disparaît dès qu'un confrère la prend. Reprise automatique au démarrage du téléphone.
2. **Console** : la console Tech Assist en plein écran (prise en charge, discussion, identifiants RustDesk, bouton « Se connecter »).

Connexion : dans la console, avec le mot de passe (et le code 2FA). L'application reçoit alors un jeton d'appareil de 30 jours
(révocable côté serveur) ; elle n'enregistre jamais le mot de passe.

## Fabrication

    gradle :app:testDebugUnitTest     # logique d'alerte, lecture du flux, reconnexion — contre un vrai serveur HTTP local
    gradle :app:assembleDebug

Publié par `.github/workflows/android-technicien.yml` à `releases/download/android-latest/tech-assist-technicien.apk`.

## Signature (mise à jour sans désinstaller)

Android refuse de mettre à jour une application signée avec une autre clé. Créez UNE FOIS une clé et enregistrez-la dans les secrets du
dépôt GitHub (Settings > Secrets and variables > Actions) — **jamais dans le dépôt, qui est public** :

    keytool -genkeypair -v -keystore techassist.jks -alias techassist -keyalg RSA -keysize 2048 -validity 10000
    base64 -w0 techassist.jks            # à coller dans ANDROID_KEYSTORE_B64

Secrets : `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Sans eux, l'APK est signé avec
une clé de débogage (la mise à jour exige de désinstaller d'abord).

## Limites connues

- Pour sonner écran éteint, Android doit autoriser l'application à rester active (la fenêtre « Rester en alerte » le demande une fois).
  Certains téléphones (Xiaomi, Huawei, Tecno, Infinix…) ont en plus un réglage « démarrage automatique / économie de batterie » à régler à la main.
- Pas de notification poussée Google (FCM) : l'écoute repose sur la connexion permanente. FCM serait la garantie maximale, mais exige un projet Firebase.
