#!/usr/bin/env bash
# Essai sur un VRAI émulateur Android : l'APK s'installe, démarre, garde le service d'alerte au premier plan, affiche la notification sonore d'une
# demande de client, la retire quand un confrère la prend, charge la console en WebView et lui donne l'interface native. Aucun plantage.
set -uo pipefail
PKG=ci.techassist.technicien
APK=apps/android-technicien/app/build/outputs/apk/debug/app-debug.apk
LOG=mock.log
fail=0
ok()  { echo "OK   $1"; }
bad() { echo "FAIL $1"; fail=1; }
check() { local name="$1"; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

adb wait-for-device
adb shell input keyevent 82 || true
adb install -r "$APK" >/dev/null && ok "installation de l'APK" || { bad "installation de l'APK"; exit 1; }
adb shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS
TOKEN=$(printf 'T%.0s' $(seq 1 40))
printf '<?xml version="1.0" encoding="utf-8" standalone="yes" ?><map><string name="token">%s</string><boolean name="battery_asked" value="true" /></map>' "$TOKEN" > prefs.xml
adb push prefs.xml /data/local/tmp/technicien.xml >/dev/null
adb shell run-as "$PKG" mkdir -p shared_prefs
adb shell run-as "$PKG" cp /data/local/tmp/technicien.xml shared_prefs/technicien.xml
adb logcat -c

adb shell am start -W -n "$PKG/.MainActivity" >/dev/null
sleep 11   # le flux s'ouvre, la demande part à +6 s
NOTIFS=$(adb shell dumpsys notification --noredact)
check "service d'alerte au premier plan" bash -c "adb shell dumpsys activity services $PKG | grep -q 'isForeground=true'"
check "notification d'état « En alerte »" bash -c "echo \"\$0\" | grep -q 'En alerte'" "$NOTIFS"
check "notification de la demande (« Un client demande un technicien »)" bash -c "echo \"\$0\" | grep -q 'Un client demande un technicien'" "$NOTIFS"
check "notification de la demande : nom du client" bash -c "echo \"\$0\" | grep -q 'Awa Kon'" "$NOTIFS"
check "canal sonore « demandes_v1 » avec le ding-dong" bash -c "echo \"\$0\" | grep -A12 'demandes_v1' | grep -qi 'sound=.*ci.techassist.technicien'" "$NOTIFS"
check "le faux serveur a vu le bon jeton" grep -q 'stream OUVERT avec le bon jeton' "$LOG"

sleep 10   # +16 s : « prise par un confrère »
NOTIFS2=$(adb shell dumpsys notification --noredact)
check "demande prise par un confrère : l'alerte disparaît" bash -c "! (echo \"\$0\" | grep -q 'Un client demande un technicien')" "$NOTIFS2"
check "l'état « En alerte » reste affiché" bash -c "echo \"\$0\" | grep -q 'En alerte'" "$NOTIFS2"

check "la console s'est chargée dans la WebView" grep -q 'page demandée : /technicien?app=1' "$LOG"
check "la page a reçu l'interface native TechAssistApp" grep -q 'bridge=true&setToken=true' "$LOG"
check "aucun plantage" bash -c "! adb logcat -d -b crash | grep -q 'FATAL EXCEPTION'"
check "aucune erreur fatale de l'application" bash -c "! adb logcat -d AndroidRuntime:E '*:S' | grep -q ci.techassist.technicien"

echo "--- journal du faux serveur ---"; cat "$LOG"
exit $fail
