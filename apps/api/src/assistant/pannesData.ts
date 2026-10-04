/**
 * Base de pannes PC, Windows et Office (≈480 fiches : cause + solution d'atelier), issue du répertoire de Franck.
 * `advanced` : la solution touche au matériel, au BIOS ou au registre — réservée à un technicien, jamais dictée à un client.
 */
export interface Panne {
  id: number;
  domain: string;
  category: string;
  title: string;
  symptom: string;
  cause: string;
  solution: string;
  advanced: boolean;
}

export const PANNES: Panne[] = [
 {
  "id": 1,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "PC refuse de s'allumer (aucun voyant, aucun bruit)",
  "symptom": "",
  "cause": "Bloc d'alimentation (PSU) HS, cordon déconnecté ou sécurité déclenchée.",
  "solution": "Débrancher le câble secteur, maintenir le bouton marche 30 s (décharge des condensateurs), tester sur une autre prise ; si inopérant, tester le bloc au trombone (court-circuit vert/noir) ou au multimètre.",
  "advanced": true
 },
 {
  "id": 2,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Ventilateurs tournent 2 secondes puis coupure immédiate",
  "symptom": "",
  "cause": "Court-circuit carte mère, connecteur CPU 4/8 broches mal enfiché ou surtension.",
  "solution": "Débrancher tous les périphériques USB, démonter la carte mère hors boîtier (montage sur carton) pour isoler une mise à la masse involontaire.",
  "advanced": true
 },
 {
  "id": 3,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Bips continus ou successifs au boot (Beep codes)",
  "symptom": "",
  "cause": "Défaillance RAM, GPU ou processeur selon la séquence du BIOS (AMI/Award/Phoenix).",
  "solution": "Déchiffrer la séquence (ex. 1 bip long + 2 courts = GPU ; bips répétés = RAM). Dépoussiérer et réinsérer le composant suspecté.",
  "advanced": true
 },
 {
  "id": 4,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Perte de l'heure et réinitialisation des paramètres BIOS à chaque coupure",
  "symptom": "",
  "cause": "Pile bouton CMOS (CR2032) déchargée (< 2,8 V).",
  "solution": "Remplacer la pile CR2032 par une neuve et reparamétrer la date/heure et l'ordre de boot.",
  "advanced": false
 },
 {
  "id": 5,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Message « No bootable device found » ou « Insert boot media »",
  "symptom": "",
  "cause": "Ordre de boot altéré, mode UEFI/Legacy désynchronisé, ou câble SATA/NVMe déconnecté/défaillant.",
  "solution": "Entrer dans le BIOS (touche Suppr/F2), vérifier la détection physique du disque, configurer le disque Windows Boot Manager en priorité #1.",
  "advanced": true
 },
 {
  "id": 6,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Blocage sur le logo du constructeur (Asus, HP, Dell, Lenovo...)",
  "symptom": "",
  "cause": "Périphérique USB défectueux en cours d'initialisation ou secteur de démarrage corrompu.",
  "solution": "Retirer clés USB, imprimantes et disques externes ; faire un reset CMOS en retirant la pile 5 minutes.",
  "advanced": false
 },
 {
  "id": 7,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Boucle infinie « Préparation de la réparation automatique »",
  "symptom": "",
  "cause": "Registre endommagé ou BCD corrompu.",
  "solution": "Ouvrir l'invite de commande WinRE et exécuter : bootrec /fixmbr, bootrec /fixboot, bootrec /rebuildbcd.",
  "advanced": true
 },
 {
  "id": 8,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Erreur SMART au boot (« Hard Disk Error »)",
  "symptom": "",
  "cause": "Disque dur/SSD présentant un nombre critique de secteurs réalloués.",
  "solution": "Sauvegarder d'urgence les données (clonage bit-à-bit), remplacer le support de stockage.",
  "advanced": false
 },
 {
  "id": 9,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Le PC s'allume tout seul dès qu'il est branché sur secteur",
  "symptom": "",
  "cause": "Paramètre BIOS « AC Power Loss » réglé sur Always On ou court-circuit sur le bouton Power.",
  "solution": "Désactiver AC Back / Restore on AC Power Loss dans le BIOS ; contrôler les pins du Front Panel.",
  "advanced": true
 },
 {
  "id": 10,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "L'ordinateur redémarre au lieu de s'éteindre",
  "symptom": "",
  "cause": "Fonctionnalité « Démarrage rapide » (Fast Startup) corrompue dans Windows.",
  "solution": "Désactiver le démarrage rapide dans Options d'alimentation > Choisir l'action des boutons d'alimentation.",
  "advanced": false
 },
 {
  "id": 11,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Mise à jour BIOS interrompue / Carte mère briquée",
  "symptom": "",
  "cause": "Coupure secteur durant le flashage de l'EEPROM.",
  "solution": "Utiliser la fonction BIOS Flashback (bouton dédié + clé USB FAT32) ou reprogrammer la puce au programmateur SPI (CH341A).",
  "advanced": true
 },
 {
  "id": 12,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "PC portable ne charge pas (LED clignote ou éteinte)",
  "symptom": "",
  "cause": "Chargeur HS, connecteur de charge DC-Jack dessoudé ou circuit de charge (MOSFET d'entrée) grillé.",
  "solution": "Mesurer la tension en sortie du chargeur (19 V/20 V) ; inspecter mécaniquement le connecteur de charge.",
  "advanced": true
 },
 {
  "id": 13,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Châssis métallique qui donne des décharges / picotements",
  "symptom": "",
  "cause": "Défaut de mise à la terre sur la prise murale de l'installation électrique.",
  "solution": "Brancher le PC sur une prise murale reliée à une terre conforme ; tester avec un différentiel.",
  "advanced": false
 },
 {
  "id": 14,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Bouton Power enfoncé ne répond plus mécaniquement",
  "symptom": "",
  "cause": "Tige plastique du boîtier brisée ou micro-switch dessoudé.",
  "solution": "Remplacer le câble Power SW ou inverser provisoirement les broches avec le bouton Reset SW sur la carte mère.",
  "advanced": true
 },
 {
  "id": 15,
  "domain": "Pannes PC et Windows",
  "category": "Démarrage, Alimentation & BIOS",
  "title": "Boucle de reboot avant même le chargement de Windows (Cold boot loop)",
  "symptom": "",
  "cause": "Profil XMP/DOCP instable sur la mémoire RAM ou voltage insuffisant.",
  "solution": "Réinitialiser le BIOS par défaut, mettre à jour le firmware UEFI de la carte mère.",
  "advanced": true
 },
 {
  "id": 16,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD CRITICAL_PROCESS_DIED",
  "symptom": "",
  "cause": "Fichier système Windows essentiel corrompu ou SSD défaillant.",
  "solution": "Lancer en invite admin : sfc /scannow puis DISM /Online /Cleanup-Image /RestoreHealth.",
  "advanced": true
 },
 {
  "id": 17,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD SYSTEM_SERVICE_EXCEPTION",
  "symptom": "",
  "cause": "Conflit de pilote matériel ou antivirus tiers non compatible.",
  "solution": "Identifier le fichier .sys nommé sur l'écran bleu ; désinstaller/mettre à jour le pilote associé en mode sans échec.",
  "advanced": true
 },
 {
  "id": 18,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD PAGE_FAULT_IN_NONPAGED_AREA",
  "symptom": "",
  "cause": "Erreur de pagination en mémoire RAM ou défaillance physique d'une barrette.",
  "solution": "Tester chaque barrette individuellement avec MemTest86 ou l'Outil de diagnostic de la mémoire Windows (mdsched.exe).",
  "advanced": false
 },
 {
  "id": 19,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD INACCESSIBLE_BOOT_DEVICE",
  "symptom": "",
  "cause": "Changement de contrôleur de stockage (AHCI vs RAID/VMD) ou pilote SSD corrompu.",
  "solution": "Vérifier le mode SATA dans le BIOS (repasser en AHCI ou inversement) ; lancer chkdsk C: /f /r depuis WinRE.",
  "advanced": true
 },
 {
  "id": 20,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD DPC_WATCHDOG_VIOLATION",
  "symptom": "",
  "cause": "Micrologiciel SSD NVMe obsolète ou pilote SATA/AHCI instable.",
  "solution": "Mettre à jour le firmware du SSD via le logiciel propriétaire (Samsung Magician, Crucial Executive, Kingston SSD Manager).",
  "advanced": false
 },
 {
  "id": 21,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD VIDEO_TDR_FAILURE",
  "symptom": "",
  "cause": "Le pilote d'affichage GPU a figé et Windows n'a pas pu le réinitialiser.",
  "solution": "Désinstaller entièrement le pilote graphique avec DDU (Display Driver Uninstaller) en mode sans échec, puis réinstaller la dernière version stable certifiée WHQL.",
  "advanced": true
 },
 {
  "id": 22,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD KERNEL_DATA_INPAGE_ERROR",
  "symptom": "",
  "cause": "Données demandées non lisibles sur le disque système (secteurs défectueux).",
  "solution": "Vérifier la santé du disque avec CrystalDiskInfo ; remplacer le support s'il est en statut « Prudence » ou « Mauvais ».",
  "advanced": false
 },
 {
  "id": 23,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD DRIVER_IRQL_NOT_LESS_OR_EQUAL",
  "symptom": "",
  "cause": "Un pilote tente d'accéder à une adresse mémoire interdite.",
  "solution": "Analyser le fichier dump (C:\\Windows\\Minidump) avec BlueScreenView ou WinDbg pour cibler le pilote coupable.",
  "advanced": false
 },
 {
  "id": 24,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD WHEA_UNCORRECTABLE_ERROR",
  "symptom": "",
  "cause": "Instabilité matérielle processeur/GPU, surchauffe extrême ou sous-voltage (undervolt/overclock agressif).",
  "solution": "Retirer tout overclocking CPU/GPU, contrôler les températures, tester une autre alimentation.",
  "advanced": false
 },
 {
  "id": 25,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD BAD_SYSTEM_CONFIG_INFO",
  "symptom": "",
  "cause": "Ruches du Registre Windows (SYSTEM, SOFTWARE) altérées.",
  "solution": "Restaurer le système à un point antérieur via WinRE ou restaurer la sauvegarde RegBack si disponible.",
  "advanced": true
 },
 {
  "id": 26,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD KMODE_EXCEPTION_NOT_HANDLED",
  "symptom": "",
  "cause": "Conflit matériel ou incompatibilité logicielle au niveau du noyau.",
  "solution": "Désinstaller les logiciels de virtualisation ou utilitaires système récemment installés ; vérifier les mises à jour Windows.",
  "advanced": false
 },
 {
  "id": 27,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD MEMORY_MANAGEMENT",
  "symptom": "",
  "cause": "Barrette RAM défectueuse, timings mémoire erronés ou slots DIMM encrassés.",
  "solution": "Nettoyer les contacts dorés de la RAM à l'alcool isopropylique ; ajuster les timings mémoire dans le BIOS.",
  "advanced": true
 },
 {
  "id": 28,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD IRQL_NOT_GREATER_OR_EQUAL",
  "symptom": "",
  "cause": "Interruption processeur mal gérée par un périphérique tiers.",
  "solution": "Mettre à jour les pilotes de la carte mère (chipset, contrôleur USB, audio).",
  "advanced": true
 },
 {
  "id": 29,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD UNMOUNTABLE_BOOT_VOLUME",
  "symptom": "",
  "cause": "Système de fichiers NTFS corrompu sur la partition Windows.",
  "solution": "Démarrer sur clé d'installation Windows, ouvrir l'invite de commande et taper : chkdsk C: /r /x.",
  "advanced": false
 },
 {
  "id": 30,
  "domain": "Pannes PC et Windows",
  "category": "Écrans bleus de la mort (BSOD) & Crashs système",
  "title": "BSOD avec erreur THREAD_STUCK_IN_DEVICE_DRIVER",
  "symptom": "",
  "cause": "Pilote matériel (souvent carte son ou Wi-Fi) bloqué dans une boucle infinie d'exécution.",
  "solution": "Désactiver le composant dans le Gestionnaire de périphériques pour valider le diagnostic, puis installer la version constructeur.",
  "advanced": false
 },
 {
  "id": 31,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Écran noir complet, mais les ventilateurs et LED du PC s'allument",
  "symptom": "",
  "cause": "Câble vidéo branché sur la carte mère au lieu de la carte graphique dédiée, ou contact RAM défaillant.",
  "solution": "Brancher le câble HDMI/DP sur la sortie du GPU ; retirer et réenclencher fermement les barrettes de RAM.",
  "advanced": true
 },
 {
  "id": 32,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Artefacts graphiques (lignes violettes/vertes, pixels qui clignotent)",
  "symptom": "",
  "cause": "Puces VRAM de la carte graphique en surchauffe ou en fin de vie (dessoudage BGA).",
  "solution": "Nettoyer le dissipateur GPU, remplacer la pâte thermique ; si persistant, remplacer la carte graphique.",
  "advanced": true
 },
 {
  "id": 33,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Écran noir avec curseur de souris visible et mobile",
  "symptom": "",
  "cause": "Le processus graphique Windows Shell (explorer.exe) ne démarre pas.",
  "solution": "Appuyer sur Ctrl + Maj + Échap, cliquer sur Fichier > Exécuter une nouvelle tâche, taper explorer.exe et valider.",
  "advanced": false
 },
 {
  "id": 34,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Écran qui scintille ou clignote de manière intermittente",
  "symptom": "",
  "cause": "Incompatibilité de taux de rafraîchissement ou câble HDMI/DisplayPort défectueux / parasité.",
  "solution": "Tester un autre câble vidéo certifié ; vérifier la fréquence (Hz) dans Paramètres d'affichage > Affichage avancé.",
  "advanced": false
 },
 {
  "id": 35,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Résolution bloquée en basse définition (800x600 ou 1024x768)",
  "symptom": "",
  "cause": "Pilote d'affichage générique Microsoft chargé au lieu du pilote NVIDIA/AMD/Intel.",
  "solution": "Installer le pilote constructeur officiel correspondant au modèle exact de la carte graphique.",
  "advanced": false
 },
 {
  "id": 36,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Écran secondaire non détecté",
  "symptom": "",
  "cause": "Raccourci de projection désactivé ou protocole HDCP bloqué.",
  "solution": "Utiliser le raccourci Win + P et sélectionner Étendre ; forcer la détection dans les paramètres d'affichage Windows.",
  "advanced": false
 },
 {
  "id": 37,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Affichage jauni ou teinté en permanence",
  "symptom": "",
  "cause": "Mode « Éclairage nocturne » actif ou profil colorimétrique ICC corrompu.",
  "solution": "Désactiver Éclairage nocturne dans les paramètres Windows ou réinitialiser le profil de couleur dans l'outil d'étalonnage.",
  "advanced": false
 },
 {
  "id": 38,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Rétroéclairage de l'écran PC portable éteint (image visible à la lampe torche)",
  "symptom": "",
  "cause": "Fusible de rétroéclairage sur la carte mère grillé ou nappe vidéo EDP sectionnée dans la charnière.",
  "solution": "Remplacer la nappe vidéo écran ou réparer la ligne 19 V du circuit backlight sur la carte mère.",
  "advanced": true
 },
 {
  "id": 39,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Message « Signal hors limites » (Out of Range)",
  "symptom": "",
  "cause": "Fréquence ou résolution configurée supérieure aux capacités physiques du moniteur.",
  "solution": "Démarrer Windows en mode basse résolution (F8 / WinRE) et réajuster la résolution native de l'écran.",
  "advanced": true
 },
 {
  "id": 40,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Bégaiement (stuttering) et déchirement d'image (tearing) en jeu",
  "symptom": "",
  "cause": "Désynchronisation entre le framerate du GPU et le rafraîchissement du moniteur.",
  "solution": "Activer G-Sync / FreeSync ou la synchronisation verticale (V-Sync) dans le panneau de contrôle GPU.",
  "advanced": false
 },
 {
  "id": 41,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Luminosité bloquée au maximum sur PC portable (curseur inactif)",
  "symptom": "",
  "cause": "Pilote d'affichage de la carte intégrée (Intel UHD / AMD Radeon Graphics) corrompu.",
  "solution": "Réinstaller le pilote du GPU intégré (iGPU) depuis le site du fabricant du processeur.",
  "advanced": false
 },
 {
  "id": 42,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Image étirée ou bandes noires sur les bords de l'écran",
  "symptom": "",
  "cause": "Mauvais ratio d'aspect (16:9 configuré sur écran 16:10 ou surbalayage HDMI actif).",
  "solution": "Désactiver l'option « Overscan » dans les paramètres de la carte graphique ou dans l'OSD de l'écran.",
  "advanced": false
 },
 {
  "id": 43,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Écran externe qui saute lors de l'allumage d'un appareil électrique à proximité",
  "symptom": "",
  "cause": "Câble vidéo non blindé sensible aux interférences électromagnétiques (EMI).",
  "solution": "Remplacer le cordon HDMI/DisplayPort par un modèle blindé à double tresse avec ferrites.",
  "advanced": false
 },
 {
  "id": 44,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Affichage inversé à 90° ou 180°",
  "symptom": "",
  "cause": "Raccourci clavier de rotation activé par erreur.",
  "solution": "Appuyer sur Ctrl + Alt + Flèche Haut pour rétablir l'orientation normale.",
  "advanced": false
 },
 {
  "id": 45,
  "domain": "Pannes PC et Windows",
  "category": "Affichage, Graphismes & Écran",
  "title": "Points lumineux statiques sur la dalle (Pixels bloqués)",
  "symptom": "",
  "cause": "Transistor du sous-pixel figé dans un état fixe.",
  "solution": "Faire tourner un outil de changement chromatique rapide (type JScreenFix) pendant 20 minutes pour tenter de débloquer le pixel.",
  "advanced": false
 },
 {
  "id": 46,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Disque dur émet des cliquetis réguliers (« Bruit de la mort »)",
  "symptom": "",
  "cause": "Tête de lecture bloquée ou moteur pas-à-pas endommagé.",
  "solution": "Couper immédiatement le PC pour éviter de rayer les plateaux magnétiques ; confier le disque à un laboratoire pour récupération en salle blanche.",
  "advanced": false
 },
 {
  "id": 47,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "SSD verrouillé en lecture seule (impossible d'écrire ou de supprimer)",
  "symptom": "",
  "cause": "Mécanisme de sécurité du contrôleur SSD activé suite à l'épuisement des cellules NAND.",
  "solution": "Sauvegarder l'intégralité des données immédiatement sur un support externe et remplacer le SSD.",
  "advanced": false
 },
 {
  "id": 48,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Disque dur externe détecté dans le Gestionnaire mais invisible dans l'Explorateur",
  "symptom": "",
  "cause": "Lettre de lecteur non attribuée ou partition au format RAW.",
  "solution": "Ouvrir diskmgmt.msc (Gestion des disques), faire clic droit sur la partition et choisir Modifier la lettre de lecteur et les chemins d'accès.",
  "advanced": false
 },
 {
  "id": 49,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Utilisation du disque bloquée à 100% en continu dans le Gestionnaire des tâches",
  "symptom": "",
  "cause": "Service de recherche Windows (Windows Search) ou SysMain (anciennement SuperFetch) en boucle d'indexation.",
  "solution": "Désactiver le service SysMain dans services.msc et vérifier l'intégrité du disque avec chkdsk.",
  "advanced": false
 },
 {
  "id": 50,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Erreur « Périphérique d'E/S inaccessible » (I/O Device Error)",
  "symptom": "",
  "cause": "Câble SATA défectueux, connecteur USB endommagé ou secteur physique illisible.",
  "solution": "Changer le câble de liaison SATA/USB et tester sur un autre port direct (au dos du PC).",
  "advanced": false
 },
 {
  "id": 51,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Partition passée au format « RAW »",
  "symptom": "",
  "cause": "Table de partition corrompue suite à un débranchement sans éjection sécurisée.",
  "solution": "Utiliser l'outil TestDisk pour réécrire la table de partition ou extraire les fichiers via un logiciel de récupération de données.",
  "advanced": false
 },
 {
  "id": 52,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Clé USB protégée en écriture (impossible de formater)",
  "symptom": "",
  "cause": "Flag logiciel actif ou puce mémoire flash en fin de cycle de réécriture.",
  "solution": "Utiliser diskpart : sélectionner le disque et exécuter attributes disk clear readonly ; si échec, la clé est matériellement HS.",
  "advanced": true
 },
 {
  "id": 53,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Capacité réelle du disque non reconnue (ex. 2 To au lieu de 4 To)",
  "symptom": "",
  "cause": "Disque initialisé en table de partitionnement MBR au lieu de GPT.",
  "solution": "Convertir le disque en format GPT via l'utilitaire mbr2gpt ou via la Gestion des disques.",
  "advanced": false
 },
 {
  "id": 54,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Suppression accidentelle de fichiers vidés de la corbeille",
  "symptom": "",
  "cause": "Répertoire d'indexation effacé, données toujours présentes sur les blocs non réécrits.",
  "solution": "Cesser toute écriture sur le disque ; exécuter Recuva ou PhotoRec pour récupérer les données.",
  "advanced": false
 },
 {
  "id": 55,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Fichiers portant des noms avec symboles étranges et inaccessibles",
  "symptom": "",
  "cause": "Corruption de la table d'allocation NTFS ($MFT).",
  "solution": "Lancer une analyse de réparation hors-ligne : chkdsk C: /f /scan.",
  "advanced": false
 },
 {
  "id": 56,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Windows refuse de formater un support de stockage",
  "symptom": "",
  "cause": "Processus en arrière-plan qui verrouille le volume ou secteurs d'amorçage corrompus.",
  "solution": "Ouvrir diskpart, taper select disk X, puis clean, puis create partition primary et format fs=ntfs quick.",
  "advanced": true
 },
 {
  "id": 57,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Demande de clé de récupération BitLocker à chaque amorçage",
  "symptom": "",
  "cause": "Registres de configuration de plateforme (PCR) modifiés sans suspension préalable de la protection.",
  "solution": "Suspendre puis réactiver le chiffrement pour rafraîchir l'association TPM : manage-bde -protectors -disable C: manage-bde -protectors -enable C:",
  "advanced": true
 },
 {
  "id": 58,
  "domain": "Pannes PC et Windows",
  "category": "Stockage, Disques durs & SSD",
  "title": "Vitesse de transfert du SSD qui chute drastiquement après quelques secondes",
  "symptom": "",
  "cause": "Mémoire cache pseudo-SLC saturée ou thermal throttling du contrôleur NVMe.",
  "solution": "Installer un dissipateur thermique métallique sur le SSD NVMe et vérifier la température avec CrystalDiskInfo.",
  "advanced": false
 },
 {
  "id": 59,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Wi-Fi connecté, mais « Pas d'accès Internet »",
  "symptom": "",
  "cause": "Mauvaise passerelle par défaut, conflit d'adresse IP ou DNS défaillant.",
  "solution": "Dans l'invite admin, exécuter : ipconfig /release ipconfig /renew ipconfig /flushdns",
  "advanced": false
 },
 {
  "id": 60,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Carte Wi-Fi disparue du Gestionnaire de périphériques (Code 10 / Code 43)",
  "symptom": "",
  "cause": "Puce Wi-Fi bloquée dans un état de veille prolongée ou problème de pilote.",
  "solution": "Éteindre le PC, débrancher l'alimentation, maintenir le bouton marche 40 s ; réinstaller le pilote officiel Intel/Realtek.",
  "advanced": false
 },
 {
  "id": 61,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Réseau Wi-Fi 5 GHz invisible sur le PC",
  "symptom": "",
  "cause": "Carte réseau 802.11n monocanal (2.4 GHz seulement) ou canal DFS non supporté par le pilote.",
  "solution": "Forcer la box/routeur sur un canal inférieur (canaux 36 à 48) ou équiper le PC d'une carte bi-bande.",
  "advanced": false
 },
 {
  "id": 62,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Conflit d'adresse IP sur le réseau local",
  "symptom": "",
  "cause": "Deux machines possèdent la même adresse IP statique.",
  "solution": "Repasser la carte réseau en DHCP automatique (Obtenir une adresse IP automatiquement).",
  "advanced": false
 },
 {
  "id": 63,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Débit Internet anormalement bridé à 100 Mbps au lieu de 1 Gbps en câble",
  "symptom": "",
  "cause": "Câble réseau Cat5 au lieu de Cat5e/6, connecteur RJ45 oxydé/abîmé (seules 4 paires sur 8 actives).",
  "solution": "Remplacer le câble réseau par un câble Cat6 certifié et vérifier le paramètre « Speed & Duplex » sur 1.0 Gbps Full Duplex.",
  "advanced": false
 },
 {
  "id": 64,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Le Bluetooth ne s'active plus ou l'interrupteur a disparu",
  "symptom": "",
  "cause": "Service de prise en charge Bluetooth arrêté ou pilote désactivé par une mise à jour.",
  "solution": "Configurer le service bthserv sur Automatique dans services.msc et redémarrer le service.",
  "advanced": false
 },
 {
  "id": 65,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Partage de réseau local Windows invisible pour les autres machines",
  "symptom": "",
  "cause": "Profil réseau configuré en « Public » au lieu de « Privé ».",
  "solution": "Basculer le profil réseau sur Privé et activer la Découverte du réseau dans le Centre de partage.",
  "advanced": false
 },
 {
  "id": 66,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Erreur « Windows n'a pas pu se connecter au réseau »",
  "symptom": "",
  "cause": "Cache de sécurité Wi-Fi désynchronisé suite à une modification de clé WPA.",
  "solution": "Cliquer sur Gérer les réseaux connus, sélectionner le réseau, cliquer sur Oublier, puis se reconnecter.",
  "advanced": false
 },
 {
  "id": 67,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Pages web inaccessibles sauf Google et YouTube",
  "symptom": "",
  "cause": "Connectivité IPv6 fonctionnelle mais connectivité IPv4 interrompue.",
  "solution": "Vérifier les paramètres du protocole IPv4 et changer les serveurs DNS pour 1.1.1.1 (Cloudflare) ou 8.8.8.8 (Google).",
  "advanced": false
 },
 {
  "id": 68,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Le VPN bloque complètement la navigation une fois déconnecté",
  "symptom": "",
  "cause": "Fonction « Kill Switch » du logiciel VPN restée active.",
  "solution": "Réouvrir le client VPN et désactiver le Kill Switch, ou réinitialiser la pile réseau avec : netsh int ip reset.",
  "advanced": false
 },
 {
  "id": 69,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Perte de connexion Wi-Fi à la sortie de veille du PC portable",
  "symptom": "",
  "cause": "Gestion de l'alimentation autorisant Windows à couper la carte réseau pour économiser l'énergie.",
  "solution": "Dans le Gestionnaire de périphériques > Carte Wi-Fi > Gestion de l'alimentation, décocher Autoriser l'ordinateur à éteindre ce périphérique.",
  "advanced": false
 },
 {
  "id": 70,
  "domain": "Pannes PC et Windows",
  "category": "Réseau, Wi-Fi & Connectivité",
  "title": "Ping très élevé et micro-coupures régulières en jeu en ligne",
  "symptom": "",
  "cause": "Analyse d'arrière-plan périodique du service Wi-Fi Windows à la recherche de nouveaux réseaux.",
  "solution": "Désactiver l'analyse en arrière-plan via des utilitaires (comme WLAN Optimizer) ou privilégier une liaison Ethernet.",
  "advanced": false
 },
 {
  "id": 71,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Aucun son ne sort des haut-parleurs ou de la prise casque",
  "symptom": "",
  "cause": "Mauvais périphérique de sortie par défaut sélectionné dans Windows.",
  "solution": "Cliquer sur l'icône de son, vérifier la liste déroulante et sélectionner la bonne carte de sortie (Realtek High Definition Audio).",
  "advanced": false
 },
 {
  "id": 72,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Périphérique USB non reconnu (Code 43)",
  "symptom": "",
  "cause": "Port USB sous-alimenté ou pilote corrompu dans le contrôleur hôte.",
  "solution": "Dans le Gestionnaire de périphériques, désinstaller tous les concentrateurs USB racine et redémarrer la machine.",
  "advanced": false
 },
 {
  "id": 73,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Microphone branché mais aucun son capté (muet)",
  "symptom": "",
  "cause": "Restrictions de confidentialité Windows bloquant l'accès au micro.",
  "solution": "Aller dans Paramètres > Confidentialité et sécurité > Microphone et activer Autoriser les applications à accéder à votre microphone.",
  "advanced": false
 },
 {
  "id": 74,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Grésillement ou souffle constant dans le casque audio",
  "symptom": "",
  "cause": "Boucle de masse électrique ou blindage insuffisant du panneau audio avant (Front Panel).",
  "solution": "Brancher le casque directement sur la prise jack verte arrière de la carte mère ou utiliser un DAC USB externe.",
  "advanced": true
 },
 {
  "id": 75,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Imprimante bloquée en statut « Hors ligne » ou documents en file d'attente bloqués",
  "symptom": "",
  "cause": "Service du Spooler d'impression Windows planté.",
  "solution": "Ouvrir l'invite admin et taper : net stop spooler del /Q /F /S \"%systemroot%\\System32\\Spool\\Printers\\*.*\" net start spooler",
  "advanced": false
 },
 {
  "id": 76,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Clavier tape des lettres fausses (ex. 'q' donne 'a', 'w' donne 'z')",
  "symptom": "",
  "cause": "Bascule involontaire de la disposition de clavier de l'AZERTY vers le QWERTY.",
  "solution": "Appuyer sur Alt + Maj ou Win + Espace pour rebasculer en Français AZERTY.",
  "advanced": false
 },
 {
  "id": 77,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Souris qui saccade ou saute de façon aléatoire",
  "symptom": "",
  "cause": "Poussière sur le capteur optique ou interférences du récepteur sans fil 2,4 GHz causées par un port USB 3.0 voisin.",
  "solution": "Brancher le dongle USB sur une rallonge ou un port USB 2.0 éloigné des ports USB 3.0 actifs ; nettoyer le capteur.",
  "advanced": false
 },
 {
  "id": 78,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Webcam intégrée non détectée ou affichant un écran noir",
  "symptom": "",
  "cause": "Cache de confidentialité physique fermé ou touche de fonction caméra (Fn + F6/F10) coupée.",
  "solution": "Vérifier le clapet mécanique sur l'objectif et réactiver la caméra via la touche de raccourci constructeur.",
  "advanced": false
 },
 {
  "id": 79,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Ports USB qui cessent de fonctionner après quelques minutes d'inactivité",
  "symptom": "",
  "cause": "Suspension sélective des concentrateurs USB activée dans le plan d'énergie.",
  "solution": "Dans les Options d'alimentation avancées, désactiver le paramètre Suspension sélective USB.",
  "advanced": false
 },
 {
  "id": 80,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Décalage son/image (désynchronisation audio) en vidéo",
  "symptom": "",
  "cause": "Améliorations audio logicielles (Enhancements) créant de la latence de traitement.",
  "solution": "Dans les propriétés audio de la sortie, cocher l'option Désactiver toutes les améliorations sonores.",
  "advanced": false
 },
 {
  "id": 81,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Touches du pavé numérique qui ne tapent rien",
  "symptom": "",
  "cause": "Verr Num (Num Lock) désactivé ou fonctionnalité « Touches souris » active.",
  "solution": "Appuyer sur la touche Verr Num ; vérifier dans Options d'ergonomie que Contrôler la souris avec le clavier est désactivé.",
  "advanced": false
 },
 {
  "id": 82,
  "domain": "Pannes PC et Windows",
  "category": "Périphériques, USB & Audio",
  "title": "Manette de jeu (Xbox / PS) non reconnue en USB",
  "symptom": "",
  "cause": "Câble USB de charge uniquement (sans lignes de données) utilisé.",
  "solution": "Remplacer le câble par un modèle complet intégrant le transfert de données (Data + Charge).",
  "advanced": false
 },
 {
  "id": 83,
  "domain": "Pannes PC et Windows",
  "category": "Performances, Surchauffe & Mécanique",
  "title": "PC s'éteint brutalement en pleine charge (jeu, rendu 3D)",
  "symptom": "",
  "cause": "Coupure thermique de sécurité CPU/GPU (atteinte de 100 °C - TjMax) ou surcharge de l'alimentation.",
  "solution": "Dépoussiérer le ventirad, remplacer la pâte thermique séchée par une pâte haute conductivité.",
  "advanced": false
 },
 {
  "id": 84,
  "domain": "Pannes PC et Windows",
  "category": "Performances, Surchauffe & Mécanique",
  "title": "Ventilateurs qui tournent à 100% en continu dès le démarrage",
  "symptom": "",
  "cause": "Mauvaise connexion de la sonde PWM (connecteur 4 broches branché sur prise 3 broches non régulée) ou profil ventilateur BIOS corrompu.",
  "solution": "Vérifier le branchement sur le port CPU_FAN de la carte mère et reconfigurer la courbe thermique dans le BIOS.",
  "advanced": true
 },
 {
  "id": 85,
  "domain": "Pannes PC et Windows",
  "category": "Performances, Surchauffe & Mécanique",
  "title": "Ralentissement général extrême de Windows (Thermal Throttling)",
  "symptom": "",
  "cause": "Processeur bridé à sa fréquence minimale (ex. 0,79 GHz) pour éviter de brûler.",
  "solution": "Vérifier les températures avec HWMonitor ; remplacer le watercooling si la pompe AIO est désamorcée ou grippée.",
  "advanced": false
 },
 {
  "id": 86,
  "domain": "Pannes PC et Windows",
  "category": "Performances, Surchauffe & Mécanique",
  "title": "Vibrations et bourdonnements mécaniques dans le boîtier",
  "symptom": "",
  "cause": "Vis de fixation desserrées ou roulement à billes d'un ventilateur usé.",
  "solution": "Identifier le ventilateur défectueux en arrêtant temporairement chaque pale au doigt, puis le remplacer ; ajouter des patins anti-vibration en caoutchouc.",
  "advanced": false
 },
 {
  "id": 87,
  "domain": "Pannes PC et Windows",
  "category": "Performances, Surchauffe & Mécanique",
  "title": "Sifflement aigu en jeu ou charge graphique (Coil Whine)",
  "symptom": "",
  "cause": "Résonance magnétique des bobines d'inductance des étages d'alimentation GPU/PSU à haute fréquence.",
  "solution": "Limiter le nombre d'images par seconde (plafonner à la fréquence de l'écran, ex. 144 Hz) pour réduire la charge instantanée des MOSFETs.",
  "advanced": true
 },
 {
  "id": 88,
  "domain": "Pannes PC et Windows",
  "category": "Performances, Surchauffe & Mécanique",
  "title": "Fuite de liquide de refroidissement d'un système Watercooling AIO",
  "symptom": "",
  "cause": "Joint de durite poreux ou microfissure au niveau de la pompe.",
  "solution": "Débrancher immédiatement le PC du secteur, éponger à l'alcool isopropylique et remplacer le système de refroidissement par un ventirad classique.",
  "advanced": false
 },
 {
  "id": 89,
  "domain": "Pannes PC et Windows",
  "category": "Performances, Surchauffe & Mécanique",
  "title": "Charnière de PC portable bloquée ou plastique du boîtier qui s'ouvre",
  "symptom": "",
  "cause": "Écrous de maintien en laiton arrachés du châssis en plastique suite à un durcissement mécanique de la charnière.",
  "solution": "Desserrer légèrement l'écrou de tension de la charnière et réparer les ancrages à la résine époxy bicomposant.",
  "advanced": false
 },
 {
  "id": 90,
  "domain": "Pannes PC et Windows",
  "category": "Performances, Surchauffe & Mécanique",
  "title": "Odeur de brûlé ou composant qui fume à l'intérieur de l'unité centrale",
  "symptom": "",
  "cause": "Condensateur électrolytique explosé ou MOSFET d'étage d'alimentation en court-circuit.",
  "solution": "Couper immédiatement le courant, inspecter visuellement la carte mère et le bloc d'alimentation pour localiser le composant carbonisé.",
  "advanced": true
 },
 {
  "id": 91,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Windows Update bloqué avec code d'erreur (ex. 0x80070002, 0x800f081f)",
  "symptom": "",
  "cause": "Cache de téléchargement des mises à jour corrompu.",
  "solution": "Réinitialiser le dossier de distribution logicielle : net stop wuauserv net stop bits rename C:\\Windows\\SoftwareDistribution SoftwareDistribution.old net start wuauserv net start bits",
  "advanced": false
 },
 {
  "id": 92,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Menu Démarrer, Barre des tâches et Recherche Windows inactifs (ne s'ouvrent pas)",
  "symptom": "",
  "cause": "Paquets système UWP Windows corrompus.",
  "solution": "Réenregistrer les composants via PowerShell (Admin) : Get-AppXPackage -AllUsers | Foreach {Add-AppxPackage -DisableDevelopmentMode -Register \"$($_.InstallLocation)\\AppXManifest.xml\"}",
  "advanced": true
 },
 {
  "id": 93,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Erreur « Fichier DLL manquant » au lancement d'un logiciel (ex. MSVCP140.dll, VCRUNTIME140.dll)",
  "symptom": "",
  "cause": "Packages redistribuables Microsoft Visual C++ manquants ou incomplets.",
  "solution": "Télécharger et installer les packs complets Visual C++ Redistributable All-in-One (versions x86 et x64).",
  "advanced": false
 },
 {
  "id": 94,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Erreur d'application 0xc000007b à l'ouverture d'un programme",
  "symptom": "",
  "cause": "Conflit d'architecture 32 bits et 64 bits dans les DLLs du dossier System32 / SysWOW64.",
  "solution": "Réinstaller proprement les runtimes DirectX et Visual C++.",
  "advanced": false
 },
 {
  "id": 95,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Fichiers personnels verrouillés avec extension modifiée et demande de rançon (Ransomware)",
  "symptom": "",
  "cause": "Chiffrement malveillant des données par un cryptolocker.",
  "solution": "Isoler immédiatement la machine du réseau ; vérifier sur le portail No More Ransom si une clé de déchiffrement publique existe, sinon restaurer une sauvegarde saine.",
  "advanced": false
 },
 {
  "id": 96,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Fenêtres publicitaires intrusives (Adware / Pop-ups constants)",
  "symptom": "",
  "cause": "Extensions de navigateur indésirables, tâches planifiées suspectes ou adwares installés.",
  "solution": "Passer un scan complet avec Malwarebytes et AdwCleaner, puis réinitialiser les navigateurs internet.",
  "advanced": false
 },
 {
  "id": 97,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Windows affiche « Vous avez été connecté avec un profil temporaire »",
  "symptom": "",
  "cause": "Échec de lecture du fichier NTUSER.DAT utilisateur, profil basculé sous extension .bak.",
  "solution": "Ouvrir regedit, aller dans HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList, localiser le dossier avec .bak, retirer l'extension .bak et vérifier le chemin correct dans ProfileImagePath.",
  "advanced": true
 },
 {
  "id": 98,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Impossible de supprimer un fichier (« Fichier utilisé par un autre programme »)",
  "symptom": "",
  "cause": "Handle système resté actif sur le fichier dans un processus en tâche de fond.",
  "solution": "Identifier et déverrouiller le processus bloquant avec l'utilitaire Process Explorer (Sysinternals) ou redémarrer en mode sans échec pour supprimer.",
  "advanced": true
 },
 {
  "id": 99,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Consommation excessive de mémoire RAM par RuntimeBroker.exe ou Svchost.exe",
  "symptom": "",
  "cause": "Application d'arrière-plan du Store défaillante ou fuite de mémoire d'un service système.",
  "solution": "Désactiver les notifications et astuces Windows dans Paramètres > Système > Notifications.",
  "advanced": false
 },
 {
  "id": 100,
  "domain": "Pannes PC et Windows",
  "category": "Système d'exploitation, Mises à jour & Logiciels",
  "title": "Crashs récurrents de l'Explorateur Windows (explorer.exe) au clic droit",
  "symptom": "",
  "cause": "Extension tierce de menu contextuel (Shell Extension) obsolète ou incompatible.",
  "solution": "Utiliser l'outil ShellExView de NirSoft pour désactiver les extensions contextuelles tierces non-Microsoft une par une jusqu'à identifier l'élément responsable.",
  "advanced": false
 },
 {
  "id": 101,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Coupure nette immédiate sans BSOD en pleine charge",
  "symptom": "",
  "cause": "Déclenchement de la protection OCP/OPP (surcharge) ou condensateur du bloc d'alimentation (PSU) en fin de vie.",
  "solution": "Remplacer le bloc par une alimentation de puissance supérieure certifiée 80 PLUS.",
  "advanced": false
 },
 {
  "id": 102,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Câble d'alimentation secteur ou rallonge avec faux contact",
  "symptom": "",
  "cause": "Connecteur C13/C14 desserré ou prise murale dégradée provoquant un micro-arc et une rupture de phase.",
  "solution": "Remplacer le cordon d'alimentation secteur et brancher directement sur une prise murale vérifiée.",
  "advanced": false
 },
 {
  "id": 103,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Court-circuit sur le rail 12V EPS (Processeur)",
  "symptom": "",
  "cause": "Un MOSFET de l'étage d'alimentation (VRM) de la carte mère a grillé et relie le 12V à la masse.",
  "solution": "Contrôler au multimètre (mode continuité) entre broche 12V et masse sur le port 8 broches CPU ; remplacer le composant en panne ou changer la carte mère.",
  "advanced": true
 },
 {
  "id": 104,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Court-circuit sur un port USB causé par un périphérique défectueux",
  "symptom": "",
  "cause": "Lamelle interne du port USB tordue touchant le blindage métallique ou clé USB en court-circuit.",
  "solution": "Débrancher tous les périphériques USB ; inspecter les connecteurs femelles et redresser délicatement les languettes isolantes.",
  "advanced": false
 },
 {
  "id": 105,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Câble modulaire de bloc d'alimentation non d'origine utilisé",
  "symptom": "",
  "cause": "Brochage interne côté alimentation non standardisé provoquant l'envoi de 12V sur une ligne de masse.",
  "solution": "Utiliser strictement les câbles fournis avec le modèle exact de l'alimentation modulaire.",
  "advanced": false
 },
 {
  "id": 106,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Mise en sécurité de l'onduleur (UPS)",
  "symptom": "",
  "cause": "Batterie de l'onduleur HS qui s'effondre dès que le PC tire de la puissance.",
  "solution": "Remplacer la batterie au plomb de l'onduleur ou brancher le PC sur le secteur pour isoler la cause.",
  "advanced": false
 },
 {
  "id": 107,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Bouton Power du boîtier bloqué en position enfoncée",
  "symptom": "",
  "cause": "Déclenchement automatique de l'extinction forcée de la carte mère après 4 secondes de contact continu.",
  "solution": "Débrancher le connecteur Power SW du Front Panel pour vérifier si le PC reste allumé.",
  "advanced": true
 },
 {
  "id": 108,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Court-circuit par entretoise métallique superflue sous la carte mère",
  "symptom": "",
  "cause": "Entretoise du boîtier en contact direct avec des pistes au dos du PCB.",
  "solution": "Démonter la carte mère et ne conserver que les entretoises correspondant aux trous de fixation du format (ATX/Micro-ATX).",
  "advanced": true
 },
 {
  "id": 109,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Câble PCIe 12VHPWR (cartes récentes) mal engagé ou fondu",
  "symptom": "",
  "cause": "Mauvais contact des broches créant une résistance thermique élevée et une fonte du plastique.",
  "solution": "Remplacer le câble 16 broches et vérifier le clic franc lors de l'insertion.",
  "advanced": false
 },
 {
  "id": 110,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Ventilateur de l'alimentation bloqué provoquant la surchauffe de celle-ci",
  "symptom": "",
  "cause": "Déclenchement de la protection thermique interne OTP du bloc PSU.",
  "solution": "Nettoyer la poussière accumulée dans le bloc ou remplacer l'alimentation.",
  "advanced": false
 },
 {
  "id": 111,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Rupture du circuit de charge sur PC portable (MOSFET d'entrée HS)",
  "symptom": "",
  "cause": "Surtension secteur détruisant les deux premiers transistors de commutation à l'entrée du jack.",
  "solution": "Remplacer les MOSFETs d'entrée au fer à souder/air chaud ou changer la carte mère.",
  "advanced": true
 },
 {
  "id": 112,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Connecteur DC-Jack d'un PC portable dessoudé ou cassé",
  "symptom": "",
  "cause": "Choc physique sur la fiche du chargeur pendant l'utilisation, bascule sur batterie puis coupure totale à 0%.",
  "solution": "Ressouder ou remplacer la nappe interne du connecteur DC-Jack.",
  "advanced": true
 },
 {
  "id": 113,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Décharge électrostatique (ESD) sur le boîtier métallique",
  "symptom": "",
  "cause": "Absence de terre sur l'installation provoquant un reset du contrôleur I/O par étincelle.",
  "solution": "Raccorder le PC à une prise de courant avec terre effective et vérifier la liaison à la terre du boîtier.",
  "advanced": false
 },
 {
  "id": 114,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Condensateur électrolytique gonflé ou qui fuit sur la carte mère",
  "symptom": "",
  "cause": "Perte de capacité de filtrage rendant les tensions instables dès qu'un composant demande du courant.",
  "solution": "Remplacer les condensateurs bombés par des équivalents Low-ESR de même tension et capacité.",
  "advanced": false
 },
 {
  "id": 115,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Surcharge d'un hub USB non alimenté",
  "symptom": "",
  "cause": "Consommation supérieure aux 500 mA / 900 mA autorisés par le contrôleur USB de la carte.",
  "solution": "Utiliser un hub USB disposant de son propre transformateur d'alimentation externe.",
  "advanced": false
 },
 {
  "id": 116,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Interrupteur I/O de l'alimentation défaillant mécaniquement",
  "symptom": "",
  "cause": "Arcs électriques répétés ayant brûlé les contacts internes du commutateur.",
  "solution": "Remplacer l'interrupteur ou changer le bloc d'alimentation.",
  "advanced": false
 },
 {
  "id": 117,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Câble SATA d'alimentation fondu (adaptateurs Molex vers SATA)",
  "symptom": "",
  "cause": "Adaptateurs moulés de mauvaise qualité sujets aux arcs électriques internes entre fils 12V et 5V.",
  "solution": "Supprimer les adaptateurs moulés ; utiliser des connecteurs sertis d'origine.",
  "advanced": false
 },
 {
  "id": 118,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Vis tombée accidentellement sur la carte mère pendant la marche",
  "symptom": "",
  "cause": "Court-circuit franc entre deux pistes ou deux pattes de composants de puissance.",
  "solution": "Retirer la vis, inspecter les traces de brûlure et tester la carte hors boîtier.",
  "advanced": false
 },
 {
  "id": 119,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Fusible de protection CMS claqué sur la carte mère d'un PC portable",
  "symptom": "",
  "cause": "Insertion à chaud d'une nappe (ex. nappe écran) pendant que la batterie était branchée.",
  "solution": "Identifier le fusible CMS marqué « F » près du connecteur et le remplacer.",
  "advanced": false
 },
 {
  "id": 120,
  "domain": "Extinctions et blocages en marche",
  "category": "Alimentation, Électricité & Court-circuit",
  "title": "Défaillance de la ligne de veille 5VSB (5V Standby)",
  "symptom": "",
  "cause": "Circuit intégré PWM auxiliaire de l'alimentation HS ; la carte ne peut plus maintenir l'état d'éveil.",
  "solution": "Tester le fil violet du connecteur 24 broches (doit donner 5V même PC éteint) ; remplacer le bloc si 0V.",
  "advanced": false
 },
 {
  "id": 121,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Coupure thermique CPU (TjMax 100°C–105°C atteinte)",
  "symptom": "",
  "cause": "Mécanisme de sécurité matériel interne au processeur (PROCHOT) qui coupe le système pour éviter la fusion du silicium.",
  "solution": "Remplacer la pâte thermique sèche, remonter correctement le ventirad.",
  "advanced": false
 },
 {
  "id": 122,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Pompe de watercooling AIO grippée ou désamorcée",
  "symptom": "",
  "cause": "Moteur de pompe bloqué par des dépôts ou bulle d'air coincée dans la chambre de pompage.",
  "solution": "Vérifier les RPM de la pompe dans le BIOS ; si 0 RPM ou tuyaux froids/brûlants asymétriques, remplacer le kit AIO.",
  "advanced": true
 },
 {
  "id": 123,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Film plastique de protection laissé sous la base du ventirad",
  "symptom": "",
  "cause": "Isolant thermique bloquant le transfert calorifique dès que la charge augmente.",
  "solution": "Démonter le dissipateur, retirer l'opercule transparent, nettoyer et remettre de la pâte thermique.",
  "advanced": true
 },
 {
  "id": 124,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Ventilateur CPU débranché ou bloqué mécaniquement par un câble",
  "symptom": "",
  "cause": "Absence de flux d'air, montée en température rapide en moins de 60 secondes.",
  "solution": "Dégager le passage des pales et vérifier le branchement sur l'en-tête CPU_FAN.",
  "advanced": false
 },
 {
  "id": 125,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Pâte thermique transformée en poudre calcaire",
  "symptom": "",
  "cause": "Pâte usée (> 4-5 ans) ayant perdu sa conductivité thermique.",
  "solution": "Nettoyer à l'alcool isopropylique et appliquer un grain de riz de pâte thermique de qualité.",
  "advanced": false
 },
 {
  "id": 126,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Surchauffe critique de la carte graphique (Hotspot GPU > 105°C)",
  "symptom": "",
  "cause": "Ventilateurs GPU non déclenchés ou pâte thermique du die GPU desséchée.",
  "solution": "Contrôler les ventilateurs de la carte graphique et repaster le processeur graphique.",
  "advanced": false
 },
 {
  "id": 127,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Radiateur de PC portable totalement colmaté par un matelas de poussière",
  "symptom": "",
  "cause": "Obstruction de la grille d'évacuation en cuivre entre le ventilateur et l'extérieur.",
  "solution": "Ouvrir le PC portable, retirer le bloc de ventilation et extraire la poussière accumulée.",
  "advanced": false
 },
 {
  "id": 128,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Décollement d'un pad thermique sur les VRM ou la VRAM",
  "symptom": "",
  "cause": "Surchauffe locale des étages de puissance coupant la carte graphique en pleine session 3D.",
  "solution": "Remplacer les pads thermiques par des modèles de bonne épaisseur (0.5 mm, 1.0 mm, 1.5 mm selon spécifications).",
  "advanced": false
 },
 {
  "id": 129,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Erreur de branchement : Pompe branchée sur SYS_FAN au lieu de PUMP_FAN",
  "symptom": "",
  "cause": "Carte mère qui régule la pompe comme un ventilateur classique en diminuant son voltage jusqu'à son arrêt.",
  "solution": "Verrouiller le connecteur de la pompe à 100% de vitesse (PWM fixe 12V) dans le BIOS.",
  "advanced": true
 },
 {
  "id": 130,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Caloduc (Heatpipe) percé ou dépressurisé",
  "symptom": "",
  "cause": "Le fluide caloporteur interne s'est évaporé, le radiateur reste froid alors que la base est brûlante.",
  "solution": "Remplacer l'ensemble du système caloduc / ventirad.",
  "advanced": false
 },
 {
  "id": 131,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Surchauffe du contrôleur de SSD NVMe (> 80°C)",
  "symptom": "",
  "cause": "SSD PCIe 4.0/5.0 dépourvu de dissipateur thermique placé juste sous une carte graphique chaude.",
  "solution": "Installer un dissipateur métallique avec pad thermique sur le SSD M.2.",
  "advanced": false
 },
 {
  "id": 132,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Flux d'air du boîtier inversé (tous les ventilateurs en extraction)",
  "symptom": "",
  "cause": "Dépression d'air extrême et stagnation de la chaleur interne.",
  "solution": "Réorganiser le flux (Airflow) : aspiration à l'avant/en bas, extraction à l'arrière/en haut.",
  "advanced": false
 },
 {
  "id": 133,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Ventirad desserré suite à la casse d'un ergot de fixation en plastique (socket AMD ou Intel)",
  "symptom": "",
  "cause": "Rupture mécanique d'un clip créant un écart d'un millimètre entre le CPU et la semelle métallique.",
  "solution": "Remplacer le système de fixation par une backplate vissée en acier.",
  "advanced": false
 },
 {
  "id": 134,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Boîtier enfermé dans un meuble clos sans aération",
  "symptom": "",
  "cause": "Montée en température ambiante interne du meuble jusqu'à l'arrêt de sécurité.",
  "solution": "Déplacer le boîtier dans une zone dégagée permettant une circulation d'air continue.",
  "advanced": false
 },
 {
  "id": 135,
  "domain": "Extinctions et blocages en marche",
  "category": "Températures Extrêmes & Refroidissement",
  "title": "Liquide de refroidissement cristallisé ou évaporé dans un AIO usé",
  "symptom": "",
  "cause": "Perméation naturelle à travers les durites en caoutchouc après plusieurs années.",
  "solution": "Remplacer l'AIO par un ventirad à air double tour fiable.",
  "advanced": false
 },
 {
  "id": 136,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Pins du socket processeur tordues ou brûlées (Socket LGA)",
  "symptom": "",
  "cause": "Mauvais alignement du processeur lors du montage créant des micro-arcs électriques sous charge.",
  "solution": "Redresser méticuleusement les broches à la loupe et à la pince de précision, ou changer la carte.",
  "advanced": false
 },
 {
  "id": 137,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Pression inégale du système de refroidissement tordant le PCB du CPU",
  "symptom": "",
  "cause": "Perte de contact d'une partie des billes sous le processeur avec le socket.",
  "solution": "Desserrer légèrement les vis de montage du dissipateur et utiliser un cadre de contact anti-flexion (Contact Frame).",
  "advanced": false
 },
 {
  "id": 138,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Puce BIOS corrompue en cours de session suite à un crash d'écriture",
  "symptom": "",
  "cause": "Mise à jour de microcode en tâche de fond ou défaillance de la puce EEPROM.",
  "solution": "Utiliser la fonction BIOS Flashback avec une clé USB ou reprogrammer la puce avec un programmateur externe CH341A.",
  "advanced": true
 },
 {
  "id": 139,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Contrôleur Super I/O (SIO) défaillant sur la carte mère",
  "symptom": "",
  "cause": "Puce ITE/Nuvoton qui gère l'allumage physique et la surveillance des tensions en panne.",
  "solution": "Dessoudage et remplacement de la puce SIO ou remplacement de la carte mère.",
  "advanced": true
 },
 {
  "id": 140,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Puce réseau (LAN) ou audio détruite par la foudre",
  "symptom": "",
  "cause": "Surtension passée par le câble Ethernet RJ45 mettant la puce en court-circuit chaud.",
  "solution": "Dessouder la puce audio/LAN en court-circuit pour libérer les lignes d'alimentation de la carte.",
  "advanced": true
 },
 {
  "id": 141,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Défaillance du circuit VRM (Phase d'alimentation brûlée)",
  "symptom": "",
  "cause": "Utilisation prolongée d'un processeur haute consommation sur une carte mère d'entrée de gamme sans dissipateur VRM.",
  "solution": "Remplacer la carte mère par un modèle équipé d'un étage d'alimentation dimensionné.",
  "advanced": true
 },
 {
  "id": 142,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Crash d'overclocking / undervolting processeur non stabilisé",
  "symptom": "",
  "cause": "Voltage CPU (Vcore) insuffisant provoquant un gel instantané ou un redémarrage direct.",
  "solution": "Effectuer un Clear CMOS (cavalier ou retrait de la pile CR2032 5 minutes) pour réinitialiser les fréquences d'usine.",
  "advanced": false
 },
 {
  "id": 143,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Profil d'énergie C-States créant une chute de tension en transition de charge",
  "symptom": "",
  "cause": "L'alimentation ne parvient pas à délivrer le courant minimal requis lors des changements d'état ultra-rapides.",
  "solution": "Désactiver les états de veille profonds C6/C7/C8 dans les paramètres CPU du BIOS.",
  "advanced": true
 },
 {
  "id": 144,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Microfissure dans les pistes internes du circuit imprimé multicouche",
  "symptom": "",
  "cause": "Déformation mécanique due au poids d'une carte graphique lourde ou d'un ventirad massif.",
  "solution": "Poser un support de renfort vertical pour GPU ; remplacer la carte si le PCB est déformé de manière irréversible.",
  "advanced": false
 },
 {
  "id": 145,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Échec de communication avec la puce TPM (Trusted Platform Module)",
  "symptom": "",
  "cause": "Plantage matériel du module TPM intégré au CPU (fTPM) figeant Windows.",
  "solution": "Mettre à jour le BIOS pour installer le correctif de bégaiement/stabilité fTPM constructeur.",
  "advanced": true
 },
 {
  "id": 146,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Courant résiduel anormal bloquant le circuit de réveil (State Lock)",
  "symptom": "",
  "cause": "Contrôleur d'alimentation bloqué dans un sous-état d'alimentation intermédiaire.",
  "solution": "Faire une décharge statique complète : débrancher le secteur, maintenir le bouton Power appuyé 40 secondes.",
  "advanced": false
 },
 {
  "id": 147,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Pâte thermique conductrice (métal liquide) qui a débordé sur les condensateurs CMS",
  "symptom": "",
  "cause": "Mauvaise isolation électrique autour du die processeur créant un court-circuit.",
  "solution": "Nettoyer immédiatement avec du solvant spécifique et réappliquer une pâte non conductrice standard.",
  "advanced": false
 },
 {
  "id": 148,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Défaillance de l'oscillateur à quartz (RTC Clock)",
  "symptom": "",
  "cause": "Perte du signal d'horloge empêchant la carte mère de cadencer les bus de communication.",
  "solution": "Remplacer le quartz d'horloge 32.768 kHz sur la carte mère.",
  "advanced": true
 },
 {
  "id": 149,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Instabilité du microcode processeur générant des erreurs arithmétiques",
  "symptom": "",
  "cause": "Dégradation matérielle des cœurs rapides suite à des tensions d'usine trop élevées.",
  "solution": "Flasher le BIOS avec le microcode constructeur correctif (réduction des limites de boost PL1/PL2).",
  "advanced": true
 },
 {
  "id": 150,
  "domain": "Extinctions et blocages en marche",
  "category": "Processeur, Carte Mère & BIOS",
  "title": "Court-circuit interne au socket après retrait brutal d'un câble USB 3.0 interne",
  "symptom": "",
  "cause": "Connecteur femelle 19 broches arraché de la carte mère reliant deux pins ensemble.",
  "solution": "Séparer les pins en contact ou couper celles qui sont tordues pour supprimer le court-circuit.",
  "advanced": true
 },
 {
  "id": 151,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Gel total de l'image (Freezing) sans écran bleu ni curseur",
  "symptom": "",
  "cause": "Secteur mémoire défectueux atteint lors de l'allocation d'une nouvelle application.",
  "solution": "Lancer MemTest86 clé bootable pour isoler la barrette défaillante et la remplacer.",
  "advanced": false
 },
 {
  "id": 152,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Oxydation ou saleté sur les contacts dorés des barrettes de RAM",
  "symptom": "",
  "cause": "Micro-coupures sur le bus de données vers le contrôleur mémoire du processeur.",
  "solution": "Frotter les contacts dorés avec une gomme propre et pulvériser du nettoyant contact dans le slot DIMM.",
  "advanced": false
 },
 {
  "id": 153,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Profil XMP / EXPO instable sous charge lourde",
  "symptom": "",
  "cause": "Timings mémoire trop agressifs ou tension DRAM légèrement insuffisante.",
  "solution": "Augmenter manuellement la tension DRAM de 0.02V dans le BIOS ou désactiver temporairement le profil XMP.",
  "advanced": true
 },
 {
  "id": 154,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Slot DIMM défectueux sur la carte mère",
  "symptom": "",
  "cause": "Soudure sèche sous le slot ou languette interne tordue.",
  "solution": "Déplacer la barrette sur un autre canal mémoire (ex. slots 2 et 4 au lieu de 1 et 3).",
  "advanced": true
 },
 {
  "id": 155,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Mélange de barrettes de RAM aux puces et fréquences disparates",
  "symptom": "",
  "cause": "Conflit de sub-timings entre puces de fabricants différents (Samsung, Hynix, Micron).",
  "solution": "Utiliser uniquement des kits mémoire vendus ensemble et testés pour fonctionner en dual-channel.",
  "advanced": false
 },
 {
  "id": 156,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Éjection partielle d'une barrette de RAM sous l'effet des vibrations",
  "symptom": "",
  "cause": "Ergot de fixation du slot mal verrouillé lors de l'assemblage.",
  "solution": "Réinsérer la barrette jusqu'à entendre le clic franc des deux côtés.",
  "advanced": false
 },
 {
  "id": 157,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Instabilité du contrôleur mémoire intégré (IMC) du processeur",
  "symptom": "",
  "cause": "Utilisation de 4 barrettes DDR5 haute fréquence imposant une charge trop lourde à l'IMC.",
  "solution": "Repasser sur une configuration à 2 barrettes seulement ou abaisser la fréquence mémoire.",
  "advanced": false
 },
 {
  "id": 158,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Surchauffe physique des puces de RAM (absence de flux d'air)",
  "symptom": "",
  "cause": "Modules DDR5 haut de gamme montant au-delà de 70°C et provoquant des erreurs de parité.",
  "solution": "Améliorer la ventilation directe au niveau des barrettes de RAM.",
  "advanced": false
 },
 {
  "id": 159,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Erreur de parité mémoire non masquable (NMI)",
  "symptom": "",
  "cause": "Rayon cosmique ou dégradation d'une cellule mémoire (Bit flip) sur mémoire non-ECC.",
  "solution": "Redémarrer le PC ; si récurrent, remplacer le module mémoire.",
  "advanced": false
 },
 {
  "id": 160,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Pression excessive du socket CPU provoquant la déconnexion d'un canal RAM",
  "symptom": "",
  "cause": "Vis du ventirad trop serrées d'un côté désactivant les pins du contrôleur mémoire.",
  "solution": "Desserrer uniformément d'un quart de tour les vis de maintien du dissipateur.",
  "advanced": false
 },
 {
  "id": 161,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Tension VDDQ/VDD2 insuffisante en charge",
  "symptom": "",
  "cause": "Baisse de tension sous forte consommation provoquant une désynchronisation du bus mémoire.",
  "solution": "Ajuster manuellement les tensions VDDQ dans le menu d'overclocking du BIOS.",
  "advanced": true
 },
 {
  "id": 162,
  "domain": "Extinctions et blocages en marche",
  "category": "Mémoire Vive (RAM)",
  "title": "Incompatibilité de topologie mémoire (Daisy Chain vs T-Topology)",
  "symptom": "",
  "cause": "Remplissage des 4 slots sur une carte mère optimisée pour 2 slots.",
  "solution": "Retirer deux barrettes pour ne conserver qu'une paire sur les canaux prioritaires.",
  "advanced": true
 },
 {
  "id": 163,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Écran noir soudain avec ventilateurs de la carte graphique qui s'emballent à 100%",
  "symptom": "",
  "cause": "Déconnexion logique du GPU due à un défaut de contact PCIe ou soudure défaillante du processeur graphique.",
  "solution": "Démonter la carte graphique, nettoyer le port PCIe, rebrancher fermement et installer un support anti-affaissement.",
  "advanced": true
 },
 {
  "id": 164,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Fissure sur le connecteur PCIe de la carte graphique lourde (PCB Crack)",
  "symptom": "",
  "cause": "Le poids de la carte sans support a fissuré les pistes microscopiques près de l'ergot de verrouillage.",
  "solution": "Réparation micro-électronique des pistes coupées ou remplacement de la carte graphique.",
  "advanced": false
 },
 {
  "id": 165,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Court-circuit sur un étage d'alimentation DrMOS de la carte graphique",
  "symptom": "",
  "cause": "Destruction d'un transistor de puissance délivrant le Vcore du GPU, entraînant la mise en sécurité de l'alimentation.",
  "solution": "Retirer la carte graphique ; si le PC démarre sans elle, confier la carte à un atelier de réparation électronique pour remplacement du composant.",
  "advanced": false
 },
 {
  "id": 166,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Crash du pilote graphique avec gel définitif de l'affichage",
  "symptom": "",
  "cause": "Défaillance TDR (Timeout Detection and Recovery) sans récupération possible par Windows.",
  "solution": "Exécuter le raccourci Win + Ctrl + Shift + B pour relancer le pilote d'affichage, puis nettoyer avec DDU.",
  "advanced": false
 },
 {
  "id": 167,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Câble Riser PCIe vertical défectueux ou non certifié Gen 4",
  "symptom": "",
  "cause": "Parasitage des signaux haute fréquence entraînant la perte de signal vidéo sous charge.",
  "solution": "Brancher la carte directement sur le port de la carte mère ou forcer la vitesse en PCIe Gen 3 dans le BIOS.",
  "advanced": true
 },
 {
  "id": 168,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Écran externe qui s'éteint tout seul (mise en veille intempestive)",
  "symptom": "",
  "cause": "Panne du circuit de rétroéclairage de l'écran ou bloc d'alimentation externe de l'écran défaillant.",
  "solution": "Éclairer la dalle à la lampe torche pour vérifier si l'image est présente en fond ; tester avec un autre moniteur.",
  "advanced": false
 },
 {
  "id": 169,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Câble DisplayPort avec broche 20 connectée (Pin 20 Issue)",
  "symptom": "",
  "cause": "La broche 20 renvoie une tension de 3,3V de l'écran vers la carte graphique, provoquant des anomalies électriques et des blocages d'allumage.",
  "solution": "Remplacer le cordon par un câble DisplayPort certifié VESA (broche 20 non reliée).",
  "advanced": false
 },
 {
  "id": 170,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Défaillance d'une puce mémoire vidéo VRAM",
  "symptom": "",
  "cause": "Bille d'étain sous une puce VRAM fracturée sous l'effet des cycles thermiques.",
  "solution": "Identifier la puce défectueuse via un logiciel de diagnostic GPU (ex. MATS/MODS) et procéder à un rebillage/remplacement.",
  "advanced": false
 },
 {
  "id": 171,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Adaptateur vidéo actif (HDMI vers VGA / DP vers HDMI) qui surchauffe",
  "symptom": "",
  "cause": "Défaillance de la puce de conversion interne entraînant une coupure du signal vidéo.",
  "solution": "Privilégier une liaison directe sans conversion active.",
  "advanced": false
 },
 {
  "id": 172,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Bascule involontaire de l'affichage sur un écran virtuel ou fantôme",
  "symptom": "",
  "cause": "Pilote créant une sortie fictive et désactivant l'écran principal.",
  "solution": "Utiliser le raccourci Win + P puis flèche bas et Entrée pour rétablir le mode duplication.",
  "advanced": false
 },
 {
  "id": 173,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Affaissement de la carte graphique causant un mauvais contact des pins arrière du port PCIe",
  "symptom": "",
  "cause": "Torsion du slot par manque de maintien mécanique.",
  "solution": "Visser l'équerre métallique au châssis et placer une cale de soutien sous l'angle libre de la carte.",
  "advanced": false
 },
 {
  "id": 174,
  "domain": "Extinctions et blocages en marche",
  "category": "Carte Graphique (GPU) & Affichage",
  "title": "Incompatibilité du protocole HDCP en lecture multimédia protégée",
  "symptom": "",
  "cause": "Échec de négociation de clé de protection entraînant un écran noir lors de la lecture d'un flux vidéo.",
  "solution": "Mettre à jour le firmware de l'écran et le pilote graphique.",
  "advanced": false
 },
 {
  "id": 175,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "SSD NVMe qui disparaît brutalement du système en pleine session",
  "symptom": "",
  "cause": "Mise en sécurité du contrôleur SSD suite à une surchauffe ou corruption interne de son micrologiciel.",
  "solution": "Couper le PC, décharger le courant, laisser refroidir, puis mettre à jour le firmware via l'utilitaire de la marque.",
  "advanced": false
 },
 {
  "id": 176,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "Disque dur mécanique qui se bloque avec un bruit de claquement régulier",
  "symptom": "",
  "cause": "Tête de lecture bloquée ou moteur désynchronisé ; le système fige en attente d'E/S disque.",
  "solution": "Déconnecter le disque immédiatement pour préserver les plateaux et faire cloner le disque en atelier.",
  "advanced": false
 },
 {
  "id": 177,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "Table de partitionnement endommagée en cours d'écriture (Disque en mode RAW)",
  "symptom": "",
  "cause": "Coupure de courant au moment d'une mise à jour de la table de fichiers NTFS.",
  "solution": "Reconstruire la table avec l'utilitaire TestDisk ou cloner vers un autre disque sain.",
  "advanced": false
 },
 {
  "id": 178,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "Faux contact sur le connecteur d'alimentation SATA plat",
  "symptom": "",
  "cause": "Pression exercée sur le plastique fragile du connecteur créant une coupure de la ligne 5V/12V.",
  "solution": "Remplacer la nappe ou utiliser un connecteur SATA droit non plié.",
  "advanced": false
 },
 {
  "id": 179,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "Gel complet de Windows avec LED d'activité disque allumée en continu",
  "symptom": "",
  "cause": "Secteur défectueux non réallouable rencontré sur le support de stockage.",
  "solution": "Contrôler les attributs SMART avec CrystalDiskInfo ; remplacer le support si le compteur d'erreurs augmente.",
  "advanced": false
 },
 {
  "id": 180,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "SSD verrouillé en lecture seule (Write-Protect matériel)",
  "symptom": "",
  "cause": "Nombre maximal de cycles d'écriture des cellules flash atteint (mécanisme de survie des données).",
  "solution": "Récupérer les fichiers en copie directe et remplacer le SSD.",
  "advanced": false
 },
 {
  "id": 181,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "Câble de données SATA défectueux (Erreurs UltraDMA CRC)",
  "symptom": "",
  "cause": "Câble pincé ou clips de verrouillage cassés générant des paquets corrompus.",
  "solution": "Remplacer le câble SATA par un modèle neuf blindé à loquet métallique.",
  "advanced": false
 },
 {
  "id": 182,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "Conflit de lignes PCIe entre un port M.2 et un port SATA",
  "symptom": "",
  "cause": "Désactivation automatique du contrôleur SATA par la carte mère suite à l'insertion d'un périphérique sur le bus partagé.",
  "solution": "Déplacer le câble SATA sur un autre port de la carte mère non partagé (consulter le manuel).",
  "advanced": true
 },
 {
  "id": 183,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "Fermeture intempestive du volume BitLocker en tâche de fond",
  "symptom": "",
  "cause": "Clé d'authentification TPM perdue provoquant un crash système immédiat.",
  "solution": "Saisir la clé de récupération de secours à 48 chiffres au redémarrage.",
  "advanced": false
 },
 {
  "id": 184,
  "domain": "Extinctions et blocages en marche",
  "category": "Disques, SSD & Stockage",
  "title": "Corruption de la ruche du Registre Windows chargée en mémoire",
  "symptom": "",
  "cause": "Échec de l'écriture différée des fichiers du Registre suite à une micro-coupure.",
  "solution": "Démarrer sur une clé USB Windows et restaurer les fichiers de registre à partir du dossier de sauvegarde.",
  "advanced": true
 },
 {
  "id": 185,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Mise à jour automatique Windows forçant un redémarrage instantané",
  "symptom": "",
  "cause": "Stratégie de mise à jour critique appliquée sans délai de notification.",
  "solution": "Configurer les « Heures d'activité » dans Windows Update pour bloquer tout redémarrage forcé en journée.",
  "advanced": false
 },
 {
  "id": 186,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Écran bleu d'arrêt brutal provoqué par un pilote tiers (.sys)",
  "symptom": "",
  "cause": "Conflit d'adresse mémoire causé par un pilote de carte son, Wi-Fi ou anti-triche de jeu.",
  "solution": "Analyser le fichier crash dump dans C:\\Windows\\Minidump avec BlueScreenView pour désinstaller le pilote fautif.",
  "advanced": false
 },
 {
  "id": 187,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Infection par un ransomware en cours de chiffrement des fichiers système",
  "symptom": "",
  "cause": "Le malware bloque les processus système essentiels, entraînant un crash puis l'impossibilité de redémarrer normalement.",
  "solution": "Isoler la machine du réseau immédiatement ; démarrer sur un système Linux Live pour évaluer l'état des données.",
  "advanced": false
 },
 {
  "id": 188,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Saturation complète de la mémoire virtuelle (Mémoire paginée pleine)",
  "symptom": "",
  "cause": "Fuite de mémoire massive d'une application entraînant le blocage total de l'OS (Out of Memory freeze).",
  "solution": "Forcer l'extinction, redémarrer, identifier le processus dans le Gestionnaire des tâches et réajuster la taille du fichier d'échange (pagefile.sys).",
  "advanced": false
 },
 {
  "id": 189,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Antivirus tiers qui bloque un fichier critique du noyau (ntoskrnl.exe)",
  "symptom": "",
  "cause": "Faux positif après une mise à jour de signatures antivirales isolant un composant de base.",
  "solution": "Démarrer en mode sans échec et désinstaller la suite antivirus tierce.",
  "advanced": true
 },
 {
  "id": 190,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Boucle de redémarrage causée par une mise à jour Windows incomplète",
  "symptom": "",
  "cause": "Échec d'écriture lors de la phase d'application des mises à jour au redémarrage.",
  "solution": "Accéder à l'environnement WinRE > Dépannage > Options avancées > Désinstaller les dernières mises à jour.",
  "advanced": true
 },
 {
  "id": 191,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Corruption du magasin de composants Windows (WinSxS)",
  "symptom": "",
  "cause": "Défaillance de cohérence des fichiers système après un arrêt forcé.",
  "solution": "Exécuter en invite de commandes administrateur : DISM /Online /Cleanup-Image /RestoreHealth sfc /scannow",
  "advanced": true
 },
 {
  "id": 192,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Pilote de contrôleur AHCI/RAID incompatible chargé à chaud",
  "symptom": "",
  "cause": "Windows perd l'accès au disque système en cours de route (INACCESSIBLE_BOOT_DEVICE).",
  "solution": "Revenir au pilote standard Microsoft dans le Gestionnaire de périphériques.",
  "advanced": false
 },
 {
  "id": 193,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Gel complet provoqué par un conflit d'interruptions matérielles (IRQL Conflict)",
  "symptom": "",
  "cause": "Deux périphériques utilisant la même ligne d'interruption sans prise en charge du partage MSI (Message Signaled Interrupts).",
  "solution": "Activer le mode MSI sur les périphériques compatibles via l'utilitaire MSI Utility v3.",
  "advanced": false
 },
 {
  "id": 194,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Processus explorer.exe qui plante et boucle sans recharger le bureau",
  "symptom": "",
  "cause": "Fichier multimédia corrompu sur le bureau dont la génération de vignette bloque le shell.",
  "solution": "Lancer le Gestionnaire des tâches (Ctrl + Maj + Échap), ouvrir une invite de commandes, et supprimer le fichier en cause.",
  "advanced": false
 },
 {
  "id": 195,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Mise en veille prolongée (Hibernation) qui échoue et bloque la machine",
  "symptom": "",
  "cause": "Fichier hiberfil.sys corrompu ne permettant pas de restaurer le contexte matériel.",
  "solution": "Désactiver puis réactiver l'hibernation en tapant : powercfg -h off powercfg -h on",
  "advanced": false
 },
 {
  "id": 196,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Incompatibilité d'un logiciel d'éclairage RGB avec les bus I2C/SMBus",
  "symptom": "",
  "cause": "Conflit d'accès direct matériel entre plusieurs utilitaires de gestion RGB (Corsair, Asus, Razer) figeant la carte mère.",
  "solution": "Ne conserver qu'un seul utilitaire ou utiliser un logiciel unifié et léger comme OpenRGB.",
  "advanced": true
 },
 {
  "id": 197,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Attaque par déni de service local (Fork bomb / Malware de minage)",
  "symptom": "",
  "cause": "Saturation instantanée des ressources processeur à 100% bloquant la gestion des entrées/sorties.",
  "solution": "Démarrer en mode sans échec avec prise en charge réseau et lancer un scan complet avec Malwarebytes.",
  "advanced": true
 },
 {
  "id": 198,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Service Windows Spooler qui fait crasher le sous-système de sécurité (LSASS)",
  "symptom": "",
  "cause": "Tentative d'exploitation d'une faille d'impression réseau faisant planter lsass.exe et provoquant un redémarrage de sécurité programmé à 60 secondes.",
  "solution": "Mettre à jour Windows et désactiver le service Spooler d'impression si l'imprimante n'est pas utilisée.",
  "advanced": false
 },
 {
  "id": 199,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Modification corrompue des variables d'environnement système",
  "symptom": "",
  "cause": "Suppression accidentelle de la variable PATH ou de SystemRoot empêchant le système de localiser ses exécutables de base.",
  "solution": "Restaurer les variables par défaut (%SystemRoot%\\system32) via le Registre en mode récupération.",
  "advanced": true
 },
 {
  "id": 200,
  "domain": "Extinctions et blocages en marche",
  "category": "Système Windows, Pilotes & Logiciels",
  "title": "Crash lors du basculement d'alimentation lié au Démarrage Rapide (Fast Startup)",
  "symptom": "",
  "cause": "Image de noyau mise en cache non synchronisée avec l'état matériel réel au réveil.",
  "solution": "Désactiver le démarrage rapide dans le Panneau de configuration > Options d'alimentation > Choisir l'action des boutons d'alimentation.",
  "advanced": false
 },
 {
  "id": 201,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Crash TDR du pilote graphique (nvlddmkm.sys / amdkmdag.sys)",
  "symptom": "Écran noir soudain, son en boucle 2 secondes, puis redémarrage ou gel total.",
  "cause": "",
  "solution": "Nettoyer les pilotes graphiques en mode sans échec avec DDU (Display Driver Uninstaller) puis installer la dernière version stable constructeur.",
  "advanced": true
 },
 {
  "id": 202,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "BSOD DRIVER_IRQL_NOT_LESS_OR_EQUAL lié à la carte réseau (ndis.sys)",
  "symptom": "Crash instantané dès le lancement d'un téléchargement lourd ou d'un flux vidéo.",
  "cause": "",
  "solution": "Désinstaller le pilote Ethernet/Wi-Fi depuis le Gestionnaire de périphériques et réinstaller le pilote fourni par le fabricant de la puce (Intel/Realtek).",
  "advanced": false
 },
 {
  "id": 203,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de filtre USB corrompu bloquant le bus d'E/S",
  "symptom": "Écran bleu ou gel complet dès l'insertion d'une clé ou d'un périphérique USB en cours de session.",
  "cause": "",
  "solution": "Supprimer les clés de filtres supérieurs/inférieurs (UpperFilters/LowerFilters) dans la ruche USB du Registre : HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{36FC9E60-C465-11CF-8056-444553540000}.",
  "advanced": true
 },
 {
  "id": 204,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Conflit du pilote audio haute définition (RTKVHD64.sys)",
  "symptom": "Gel système immédiat ou arrêt lors de l'ouverture d'une application utilisant le microphone.",
  "cause": "",
  "solution": "Basculer le pilote audio Realtek vers le pilote générique Microsoft « Périphérique High Definition Audio ».",
  "advanced": false
 },
 {
  "id": 205,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote du contrôleur AHCI/RAID écrasé par Windows Update",
  "symptom": "Écran bleu INACCESSIBLE_BOOT_DEVICE en pleine session puis boucle au redémarrage.",
  "cause": "",
  "solution": "Démarrer sur WinRE, restaurer les pilotes d'origine via la commande : dism /Image:C:\\ /Remove-Driver /Driver:oemX.inf.",
  "advanced": true
 },
 {
  "id": 206,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de pont Bluetooth (bthport.sys) en panique noyau",
  "symptom": "Arrêt avec écran bleu dès la connexion d'un casque ou d'une manette sans fil.",
  "cause": "",
  "solution": "Désactiver la gestion d'énergie Bluetooth et mettre à jour le firmware/driver Bluetooth.",
  "advanced": false
 },
 {
  "id": 207,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote d'émulateur Android ou de lecteur virtuel (ex. vboxdrv.sys)",
  "symptom": "Freeze direct de la machine au lancement de la virtualisation.",
  "cause": "",
  "solution": "Désactiver l'isolation du noyau (Core Isolation) ou mettre à jour VirtualBox/BlueStacks à la version compatible Windows 11/10.",
  "advanced": false
 },
 {
  "id": 208,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Incompatibilité du pilote de gestion d'énergie Intel DPTF / AMD PPM",
  "symptom": "Windows s'éteint sans message comme si la batterie était vide.",
  "cause": "",
  "solution": "Réinstaller le pack de pilotes du chipset de la carte mère (Intel MEI / AMD Chipset Drivers).",
  "advanced": true
 },
 {
  "id": 209,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de manette ou volant générique corrompu (xusb21.sys)",
  "symptom": "Redémarrage immédiat dès que la manette vibre.",
  "cause": "",
  "solution": "Forcer l'assignation du pilote « Périphérique Xbox 360 pour Windows » officiel dans le Gestionnaire de périphériques.",
  "advanced": false
 },
 {
  "id": 210,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de pavé tactile (Touchpad I2C) qui fait planter l'ordonnanceur",
  "symptom": "Curseur qui se fige, puis extinction forcée après quelques secondes.",
  "cause": "",
  "solution": "Désinstaller le pilote Synaptics/ELAN et utiliser le pilote natif Microsoft Precision Touchpad.",
  "advanced": false
 },
 {
  "id": 211,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote d'imprimante tiers corrompu dans le spooler noyau (win32kfull.sys)",
  "symptom": "BSOD lors du lancement d'une impression depuis un logiciel bureautique.",
  "cause": "",
  "solution": "Supprimer le pilote d'impression via la console printmanagement.msc.",
  "advanced": false
 },
 {
  "id": 212,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Incompatibilité d'un pilote de lecteur de carte à puce / token d'authentification",
  "symptom": "Arrêt instantané lors de l'insertion d'un certificat ou d'une carte d'authentification.",
  "cause": "",
  "solution": "Mettre à jour les middlewares cryptographiques et désactiver les services de carte à puce obsolètes.",
  "advanced": false
 },
 {
  "id": 213,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de VPN tiers (wintun.sys ou tap0901.sys) corrompu",
  "symptom": "Déconnexion réseau suivie d'un plantage complet de l'OS lors du handshake de connexion.",
  "cause": "",
  "solution": "Réinitialiser la pile réseau avec : netsh winsock reset netsh int ip reset",
  "advanced": false
 },
 {
  "id": 214,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de capteur biométrique (empreinte / Windows Hello) défaillant",
  "symptom": "Arrêt brutal ou freeze lors du déverrouillage en sortie de veille.",
  "cause": "",
  "solution": "Réinitialiser la base de données biométrique dans C:\\Windows\\System32\\WinBioDatabase.",
  "advanced": false
 },
 {
  "id": 215,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote d'accélération matérielle de webcam (stream.sys)",
  "symptom": "Crash système à l'ouverture de Teams, Zoom ou de l'application Caméra.",
  "cause": "",
  "solution": "Désactiver l'accès aux flux vidéo dans les paramètres de confidentialité, puis réinstaller le pilote de la caméra.",
  "advanced": false
 },
 {
  "id": 216,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de disque virtuel ISO obsolète (Daemon Tools / PowerISO)",
  "symptom": "BSOD SYSTEM_SERVICE_EXCEPTION lors du montage d'un fichier image.",
  "cause": "",
  "solution": "Désinstaller complètement ces outils et utiliser le monteur ISO natif intégré à Windows.",
  "advanced": false
 },
 {
  "id": 217,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Conflit de pilote PCI Express (pci.sys)",
  "symptom": "Arrêt net lors du passage en mode d'économie d'énergie PCIe (ASPM).",
  "cause": "",
  "solution": "Dans les Options d'alimentation avancées, régler « Liaison PCI Express / Gestion de l'alimentation » sur Désactivé.",
  "advanced": false
 },
 {
  "id": 218,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de stockage secondaire externe (UASP Storage Driver)",
  "symptom": "Crash au débranchement d'un disque dur externe sans passer par « Éjecter en toute sécurité ».",
  "cause": "",
  "solution": "Configurer la stratégie de suppression du disque sur « Suppression rapide » au lieu de « Meilleures performances ».",
  "advanced": false
 },
 {
  "id": 219,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote d'overclocking logiciel constructeur (Ryzen Master, Intel XTU)",
  "symptom": "Windows s'éteint dès l'arrivée sur le bureau lors de l'application automatique du profil logiciel.",
  "cause": "",
  "solution": "Démarrer en mode sans échec et supprimer les services AMDRyzenMasterDriver ou IOCBios.",
  "advanced": true
 },
 {
  "id": 220,
  "domain": "Pannes logicielles Windows",
  "category": "Pilotes (Drivers) & Conflits Noyau",
  "title": "Pilote de convertisseur USB-Série (FTDI / Prolific) contrefait",
  "symptom": "BSOD immédiat dès l'ouverture du port COM par un logiciel de diagnostic.",
  "cause": "",
  "solution": "Bloquer la mise à jour automatique des pilotes de ports COM et installer un pilote legacy WHQL stable.",
  "advanced": false
 },
 {
  "id": 221,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Corruption du noyau Windows (ntoskrnl.exe)",
  "symptom": "Extinction aléatoire en cours d'utilisation suivie de l'impossibilité de charger l'OS.",
  "cause": "",
  "solution": "Lancer depuis une invite administrateur : DISM /Online /Cleanup-Image /RestoreHealth sfc /scannow",
  "advanced": true
 },
 {
  "id": 222,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Corruption de la bibliothèque des types d'exécution (hal.dll)",
  "symptom": "Gel total de l'OS avec arrêt des échanges d'interruptions système.",
  "cause": "",
  "solution": "Réparer le magasin de composants Windows avec DISM en utilisant une image ISO source saine : DISM /Online /Cleanup-Image /RestoreHealth /Source:wim:D:\\sources\\install.wim:1 /LimitAccess.",
  "advanced": true
 },
 {
  "id": 223,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Fichier de pagination virtuel (pagefile.sys) corrompu",
  "symptom": "Crash brutal lors du basculement d'une application lourde en tâche de fond.",
  "cause": "",
  "solution": "Désactiver temporairement la mémoire virtuelle, redémarrer le PC, puis la réactiver sur une taille personnalisée gérée par le système.",
  "advanced": false
 },
 {
  "id": 224,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Fichier de mise en veille prolongée (hiberfil.sys) altéré",
  "symptom": "Le PC s'éteint normalement mais refuse de redémarrer (blocage sur écran noir au boot suivant).",
  "cause": "",
  "solution": "Réinitialiser le cache d'hibernation en exécutant : powercfg /h off powercfg /h on",
  "advanced": false
 },
 {
  "id": 225,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Fonctionnalité Démarrage Rapide (Fast Startup) désynchronisée",
  "symptom": "Le PC plante à l'extinction ou redémarre immédiatement en boucle au lieu de rester éteint.",
  "cause": "",
  "solution": "Désactiver le Démarrage Rapide dans :",
  "advanced": false
 },
 {
  "id": 226,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Corruption du magasin de configuration de démarrage (BCD)",
  "symptom": "Arrêt brutal en session suite à une écriture système défaillante, puis erreur 0xc0000098 au démarrage.",
  "cause": "",
  "solution": "Démarrer sur WinRE et exécuter : bootrec /rebuildbcd",
  "advanced": true
 },
 {
  "id": 227,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Épuisement de la réserve de mémoire paginée (Non-Paged Pool Leak)",
  "symptom": "Le système ralentit de minute en minute puis fige totalement sans message.",
  "cause": "",
  "solution": "Identifier le tag de mémoire coupable avec l'outil PoolMon (du SDK Windows) et désactiver le service associé.",
  "advanced": false
 },
 {
  "id": 228,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Corruption du cache des polices système (FNTCACHE.DAT)",
  "symptom": "Crash de l'interface utilisateur graphique et fermeture immédiate de session.",
  "cause": "",
  "solution": "Supprimer le fichier C:\\Windows\\System32\\FNTCACHE.DAT et redémarrer la machine.",
  "advanced": false
 },
 {
  "id": 229,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Blocage de l'ordonnanceur de tâches Windows (taskschd.msc)",
  "symptom": "Extinction planifiée inopinée causée par une tâche tierce résiduelle masquée.",
  "cause": "",
  "solution": "Ouvrir le Planificateur de tâches, inspecter Bibliothèque du planificateur et supprimer les déclencheurs d'arrêt (shutdown.exe).",
  "advanced": false
 },
 {
  "id": 230,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Défaillance du sous-système de runtime Windows (csrss.exe)",
  "symptom": "BSOD immédiat CRITICAL_PROCESS_DIED dès qu'un programme tente d'interagir avec la console GUI.",
  "cause": "",
  "solution": "Vérifier l'absence de logiciels de personnalisation d'interface (WindowBlinds, StartAllBack obsolètes) et les désinstaller.",
  "advanced": false
 },
 {
  "id": 231,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Corruption du dossier temporaire de mise à jour (SoftwareDistribution)",
  "symptom": "Gel total de la machine lors de la recherche automatique de mises à jour en arrière-plan.",
  "cause": "",
  "solution": "Réinitialiser le cache Windows Update : net stop wuauserv net stop bits rename C:\\Windows\\SoftwareDistribution SoftwareDistribution.bak net start wuauserv net start bits",
  "advanced": false
 },
 {
  "id": 232,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Crash de l'API de gestion des graphiques DirectX (dxgkrnl.sys)",
  "symptom": "Arrêt forcé avec écran noir dès le passage d'une fenêtre en mode plein écran exclusif.",
  "cause": "",
  "solution": "Réinstaller les runtimes finaux pour l'utilisateur final DirectX 9/11/12 et désactiver l'accélération matérielle dans les applications de bureau.",
  "advanced": false
 },
 {
  "id": 233,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Saturation de l'espace de stockage de la partition système (C:)",
  "symptom": "Windows ne peut plus écrire les métadonnées système temporaires et coupe la session brutalement.",
  "cause": "",
  "solution": "Lancer le nettoyage de disque (cleanmgr) en mode administrateur et supprimer les fichiers d'installation précédents (Windows.old).",
  "advanced": false
 },
 {
  "id": 234,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Corruption de la bibliothèque de cryptographie d'authentification (rsaenh.dll)",
  "symptom": "Arrêt du système lors de toute tentative de signature numérique ou de connexion sécurisée SSL.",
  "cause": "",
  "solution": "Réenregistrer la DLL système via l'invite administrateur : regsvr32 rsaenh.dll.",
  "advanced": true
 },
 {
  "id": 235,
  "domain": "Pannes logicielles Windows",
  "category": "Système d'Exploitation, Fichiers Noyau & WinSxS",
  "title": "Blocage du service de télémétrie Windows (DiagTrack / Connected User Experiences)",
  "symptom": "Utilisation processeur à 100 % en tâche de fond suivie d'un freeze complet de la machine.",
  "cause": "",
  "solution": "Désactiver le service Connected User Experiences and Telemetry dans services.msc.",
  "advanced": false
 },
 {
  "id": 236,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Corruption de la ruche SYSTEM du Registre",
  "symptom": "Crash instantané du système lors du montage d'un périphérique ou d'un changement de stratégie.",
  "cause": "",
  "solution": "Restaurer les ruches du Registre depuis WinRE en copiant les fichiers sains depuis C:\\Windows\\System32\\config\\RegBack (si configuré) ou via un point de restauration.",
  "advanced": true
 },
 {
  "id": 237,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Corruption de la ruche SOFTWARE liée aux services de démarrage",
  "symptom": "Extinction automatique après l'ouverture de session utilisateur.",
  "cause": "",
  "solution": "Démarrer en mode sans échec et purger les clés de lancement automatique : HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run.",
  "advanced": true
 },
 {
  "id": 238,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Profil utilisateur Windows temporaire bloqué (.bak dans ProfileList)",
  "symptom": "Fermeture de session automatique immédiate après avoir tapé le mot de passe.",
  "cause": "",
  "solution": "Ouvrir regedit, naviguer vers HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList, supprimer la sous-clé terminant par .bak et rétablir le bon chemin de ProfileImagePath.",
  "advanced": true
 },
 {
  "id": 239,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Valeur Shell du Registre altérée par un script tiers",
  "symptom": "Le bureau ne se charge pas, écran noir avec curseur, impossible de lancer quoi que ce soit.",
  "cause": "",
  "solution": "Vérifier dans HKLM\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon que la clé Shell a bien la valeur stricte explorer.exe.",
  "advanced": true
 },
 {
  "id": 240,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Clé Userinit modifiée ou pointant vers un fichier supprimé",
  "symptom": "Déconnexion immédiate à la seconde où l'utilisateur clique sur sa session.",
  "cause": "",
  "solution": "Remettre la valeur par défaut exacte : C:\\Windows\\system32\\userinit.exe, dans la clé Winlogon du Registre.",
  "advanced": true
 },
 {
  "id": 241,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Périphérique bloqué par un filtre de classe corrompu (Class UpperFilters)",
  "symptom": "Plantage au démarrage des services disques ou CD-ROM virtuels.",
  "cause": "",
  "solution": "Supprimer les valeurs UpperFilters non reconnues dans HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4D36E967-E325-11CE-BFC1-08002BE10318}.",
  "advanced": true
 },
 {
  "id": 242,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Corruption de la ruche utilisateur (NTUSER.DAT)",
  "symptom": "Blocage définitif sur l'écran « Bienvenue » qui tourne sans fin.",
  "cause": "",
  "solution": "Créer un nouveau compte administrateur local via la ligne de commande en WinRE : net user AdminTemp MotDePasse /add puis net localgroup Administrateurs AdminTemp /add.",
  "advanced": true
 },
 {
  "id": 243,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Permissions ACL corrompues sur la racine du Registre",
  "symptom": "Les services Windows n'ont plus le droit de lire leurs propres configurations et coupent l'OS.",
  "cause": "",
  "solution": "Réinitialiser les autorisations système avec l'utilitaire SubInACL ou réappliquer une image système saine.",
  "advanced": false
 },
 {
  "id": 244,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Paramètre CrashDumpEnabled configuré avec un dossier inexistant",
  "symptom": "Blocage total lors de la tentative d'écriture d'un rapport de crash, forçant une coupure manuelle.",
  "cause": "",
  "solution": "Régler la valeur DWORD CrashDumpEnabled sur 7 (minidump standard) dans HKLM\\SYSTEM\\CurrentControlSet\\Control\\CrashControl.",
  "advanced": true
 },
 {
  "id": 245,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Modification erronée de la clé ServicesPipeTimeout",
  "symptom": "Les services Windows critiques dépassent le délai de démarrage et entraînent l'arrêt du système.",
  "cause": "",
  "solution": "Créer ou réajuster la valeur DWORD ServicesPipeTimeout à 60000 (60 secondes) dans HKLM\\SYSTEM\\CurrentControlSet\\Control.",
  "advanced": true
 },
 {
  "id": 246,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Corruption de la clé d'enregistrement de classe COM/OLE",
  "symptom": "Gel complet de la barre des tâches et du menu Démarrer rendant Windows inerte.",
  "cause": "",
  "solution": "Exécuter en PowerShell administrateur : Get-AppXPackage -AllUsers | Foreach {Add-AppxPackage -DisableDevelopmentMode -Register \"$($_.InstallLocation)\\AppXManifest.xml\"}",
  "advanced": false
 },
 {
  "id": 247,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Clé BootDriverFlags mal paramétrée",
  "symptom": "Windows ignore les pilotes de stockage d'amorçage et crash en arrivant sur le bureau.",
  "cause": "",
  "solution": "Réinitialiser la valeur BootDriverFlags à 0 dans HKLM\\SYSTEM\\CurrentControlSet\\Control.",
  "advanced": true
 },
 {
  "id": 248,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Stratégie de groupe locale (GPO) conflictuelle (Arrêt forcé programmé)",
  "symptom": "L'ordinateur affiche « Arrêt en cours » de manière régulière sans action de l'utilisateur.",
  "cause": "",
  "solution": "Supprimer les dossiers de stratégies locales corrompues : C:\\Windows\\System32\\GroupPolicy et exécuter gpupdate /force.",
  "advanced": false
 },
 {
  "id": 249,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Corruption de la ruche BCD chargée dans le Registre (HKLM\\BCD00000000)",
  "symptom": "Impossible de modifier ou de valider la configuration de démarrage, crash lors de la mise en veille.",
  "cause": "",
  "solution": "Décharger la ruche via reg unload HKLM\\BCD00000000 et réparer l'amorçage via WinRE.",
  "advanced": true
 },
 {
  "id": 250,
  "domain": "Pannes logicielles Windows",
  "category": "Registre Windows (Registry) & Profils Utilisateurs",
  "title": "Attribut de Registre PendingFileRenameOperations bloqué en boucle",
  "symptom": "Installations et démarrages logiciels qui forcent un redémarrage continu du PC.",
  "cause": "",
  "solution": "Vider le contenu de la chaîne multi-valeurs PendingFileRenameOperations dans HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager.",
  "advanced": true
 },
 {
  "id": 251,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Plantage du service d'authentification de sécurité (lsass.exe)",
  "symptom": "Message d'avertissement : « Windows va redémarrer dans 1 minute car le processus LSASS a échoué ».",
  "cause": "",
  "solution": "Analyser les infections malveillantes injectées dans la mémoire d'authentification ou désinstaller la mise à jour cumulative responsable.",
  "advanced": false
 },
 {
  "id": 252,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Plantage du gestionnaire de sessions (smss.exe)",
  "symptom": "Écran bleu immédiat CRITICAL_PROCESS_DIED sans aucun délai.",
  "cause": "",
  "solution": "Rétablir l'intégrité des fichiers binaires système de session avec la commande sfc /scannow.",
  "advanced": false
 },
 {
  "id": 253,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Plantage du sous-système client/serveur (winlogon.exe)",
  "symptom": "Déconnexion violente suivie d'un freeze noir complet de l'écran.",
  "cause": "",
  "solution": "Vérifier l'absence d'intercepteurs de frappe (keyloggers) ou de modules de session tiers modifiés.",
  "advanced": false
 },
 {
  "id": 254,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Boucle infinie du service de spouleur d'impression (spoolsv.exe)",
  "symptom": "Saturation processeur/mémoire entraînant l'extinction forcée des services dépendants.",
  "cause": "",
  "solution": "Purger les fichiers en file d'attente d'impression corrompus dans : C:\\Windows\\System32\\spool\\PRINTERS.",
  "advanced": false
 },
 {
  "id": 255,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Service SysMain (SuperFetch) bloqué sur un disque logique corrompu",
  "symptom": "Freeze complet de la machine après 5 minutes de fonctionnement.",
  "cause": "",
  "solution": "Désactiver le service SysMain dans la console services.msc.",
  "advanced": false
 },
 {
  "id": 256,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Échec critique du service de gestion des disques virtuels (vds.exe)",
  "symptom": "Gel total de l'Explorateur et de toute tentative d'accès aux fichiers en session.",
  "cause": "",
  "solution": "Redémarrer le service Disque virtuel et exécuter un contrôle logique chkdsk C: /f.",
  "advanced": false
 },
 {
  "id": 257,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Plantage en chaîne de l'hôte de services générique (svchost.exe)",
  "symptom": "Perte simultanée de l'audio, du réseau, puis écran bleu d'arrêt.",
  "cause": "",
  "solution": "Isoler le groupe de services défaillant via le Gestionnaire des tâches (onglet Détails, tri par PID).",
  "advanced": false
 },
 {
  "id": 258,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Service Windows Search (SearchIndexer.exe) corrompu",
  "symptom": "Le fichier de base de données Windows.edb gonfle jusqu'à saturation complète de la RAM et crash de l'OS.",
  "cause": "",
  "solution": "Reconstruire l'index de recherche dans :",
  "advanced": false
 },
 {
  "id": 259,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Service de journal d'événements Windows (eventlog) arrêté ou inaccessible",
  "symptom": "Windows bloque les démarrages de services de sécurité et refuse les ouvertures de session.",
  "cause": "",
  "solution": "Restaurer les droits d'accès sur le dossier C:\\Windows\\System32\\Winevt\\Logs.",
  "advanced": false
 },
 {
  "id": 260,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Plantage du service d'appel de procédure distante (RpcSs)",
  "symptom": "Toutes les fenêtres se figent, le curseur tourne en boucle, Windows s'éteint automatiquement.",
  "cause": "",
  "solution": "Vérifier les dépendances réseau et désactiver les logiciels de pare-feu tiers non compatibles.",
  "advanced": false
 },
 {
  "id": 261,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Service de chiffrement Windows (CryptSvc) saturant le catalogue de clés",
  "symptom": "Gel complet de la machine lors de l'installation de n'importe quel pilote ou logiciel signé.",
  "cause": "",
  "solution": "Renommer le dossier corrompu Catroot2 situé dans C:\\Windows\\System32\\catroot2.",
  "advanced": false
 },
 {
  "id": 262,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Conflit sur le service Infrastructure de tâches en arrière-plan (BrokerInfrastructure)",
  "symptom": "Les applications modernes UWP crashent en boucle jusqu'au gel de la barre des tâches.",
  "cause": "",
  "solution": "Réinitialiser le magasin de composants Windows via PowerShell en ligne de commande.",
  "advanced": false
 },
 {
  "id": 263,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Arrêt impromptu du service Gestionnaire de session du Gestionnaire de fenêtres (dwm.exe)",
  "symptom": "Clignotement de l'écran, passage en noir, fermeture brutale de tous les logiciels de travail.",
  "cause": "",
  "solution": "Désactiver l'accélération matérielle GPU planifiée (HAGS) dans les paramètres d'affichage avancés de Windows.",
  "advanced": false
 },
 {
  "id": 264,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Fuite de mémoire dans le service de localisation Windows (lfsvc)",
  "symptom": "Arrêt de la machine par épuisement de ressources lors de l'utilisation de navigateurs ou cartes.",
  "cause": "",
  "solution": "Désactiver le service de positionnement dans services.msc et bloquer la localisation dans les réglages système.",
  "advanced": false
 },
 {
  "id": 265,
  "domain": "Pannes logicielles Windows",
  "category": "Services Windows & Processus Critiques",
  "title": "Service Windows Error Reporting (WerSvc) bloqué en écriture infinie",
  "symptom": "Disque verrouillé à 100 % d'activité suite à un crash applicatif mineur, conduisant à l'inaccessibilité de l'OS.",
  "cause": "",
  "solution": "Vider le répertoire des rapports de plantage : C:\\ProgramData\\Microsoft\\Windows\\WER.",
  "advanced": false
 },
 {
  "id": 266,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Mise à jour de sécurité cumulative corrompue en cours d'application",
  "symptom": "Windows fige à mi-parcours de session, puis affiche un écran bleu au redémarrage suivant.",
  "cause": "",
  "solution": "Désinstaller le dernier paquet de mise à jour depuis l'environnement WinRE : wusa /uninstall /kb:XXXXXXX ou via Dépannage > Désinstaller les dernières mises à jour.",
  "advanced": true
 },
 {
  "id": 267,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Redémarrage forcé intempestif imposé par la stratégie Windows Update",
  "symptom": "Extinction directe sans validation de l'utilisateur pendant un travail en cours.",
  "cause": "",
  "solution": "Activer la stratégie de groupe : « Pas de redémarrage automatique avec des utilisateurs connectés pour les installations de mises à jour planifiées » via gpedit.msc.",
  "advanced": true
 },
 {
  "id": 268,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Échec de la mise à jour de plateforme de maintenance (Servicing Stack Update - SSU)",
  "symptom": "Blocage définitif de l'ordinateur en session avec impossibilité de fermer ou relancer Windows.",
  "cause": "",
  "solution": "Forcer l'extinction, démarrer sur clé bootable et réinjecter la dernière SSU autonome via la commande DISM hors-ligne.",
  "advanced": true
 },
 {
  "id": 269,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Mise à jour du microcode processeur via Windows Update (mcupdate_genuineintel.dll / mcupdate_authenticamd.dll)",
  "symptom": "BSOD immédiat ou extinction nette sous charge lourde après une mise à jour d'OS.",
  "cause": "",
  "solution": "Supprimer ou renommer le fichier de microcode Windows Update incriminé dans C:\\Windows\\System32 depuis un environnement WinPE.",
  "advanced": false
 },
 {
  "id": 270,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Boucle « Annulation des modifications apportées à votre ordinateur »",
  "symptom": "La mise à jour échoue en arrière-plan, provoquant l'extinction automatique du PC pour rollback.",
  "cause": "",
  "solution": "Supprimer le fichier de transaction d'installation en cours : C:\\Windows\\WinSxS\\pending.xml depuis WinRE.",
  "advanced": true
 },
 {
  "id": 271,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Mise à jour du pilote de contrôleur de stockage injectée en tâche de fond",
  "symptom": "Windows perd soudainement la communication avec le disque système principal et plante net.",
  "cause": "",
  "solution": "Bloquer l'inclusion des pilotes matériels dans les mises à jour Windows via la stratégie locale :",
  "advanced": false
 },
 {
  "id": 272,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Corruption du composant d'activation de licence Windows (sppsvc.exe)",
  "symptom": "Fermeture de session inopinée avec arrêt automatique toutes les 60 minutes (mode notification d'expiration).",
  "cause": "",
  "solution": "Réinitialiser l'état d'activation en ligne de commande administrateur : slmgr /rearm puis redémarrer.",
  "advanced": false
 },
 {
  "id": 273,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Incompatibilité d'un patch facultatif (mise à jour « Preview » de fin de mois)",
  "symptom": "Instabilité logicielle générale et redémarrages inattendus.",
  "cause": "",
  "solution": "Ne jamais cocher l'option « Recevoir les dernières mises à jour dès qu'elles sont disponibles » dans Windows Update pour éviter les pré-versions instables.",
  "advanced": false
 },
 {
  "id": 274,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Mise à jour de la sécurité dynamique du WinRE partition (KB5034441 et similaires)",
  "symptom": "Échec d'écriture provoquant un freeze de l'OS lié à une taille insuffisante de la partition de récupération.",
  "cause": "",
  "solution": "Agrandir manuellement la partition WinRE d'au moins 500 Mo via diskpart avant d'appliquer le correctif.",
  "advanced": true
 },
 {
  "id": 275,
  "domain": "Pannes logicielles Windows",
  "category": "Mises à Jour Windows Update & Paquets Système",
  "title": "Conflit entre les mises à jour du Microsoft Store et les runtimes système",
  "symptom": "Crash du sous-système graphique à la mise à jour silencieuse du Panneau de contrôle NVIDIA/AMD du Store.",
  "cause": "",
  "solution": "Désactiver la mise à jour automatique des applications dans les paramètres du Microsoft Store.",
  "advanced": false
 },
 {
  "id": 276,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Faux positif destructeur de l'antivirus tiers sur un binaire système",
  "symptom": "L'antivirus met en quarantaine explorer.exe ou user32.dll ; crash immédiat de la machine.",
  "cause": "",
  "solution": "Démarrer en mode sans échec, ouvrir la console de l'antivirus, restaurer le fichier en exception, ou désinstaller l'antivirus.",
  "advanced": true
 },
 {
  "id": 277,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Conflit mortel entre deux suites antivirus actives en temps réel",
  "symptom": "Verrouillage mutuel des threads système (Deadlock), gel complet du PC à 100 % d'activité disque.",
  "cause": "",
  "solution": "Démarrer en mode sans échec et désinstaller l'une des deux suites de protection avec son outil de nettoyage officiel (Removal Tool).",
  "advanced": true
 },
 {
  "id": 278,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Ransomware (Rançongiciel) en cours d'exécution active",
  "symptom": "Arrêt brutal du système après saturation d'écriture disque et injection de code dans les processus maîtres.",
  "cause": "",
  "solution": "Isoler la machine du réseau local (débrancher Ethernet/Wi-Fi immédiatement), démarrer sur un support externe d'analyse antivirus autonome (Kaspersky Rescue Disk).",
  "advanced": false
 },
 {
  "id": 279,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Pilote anti-triche de jeu vidéo de niveau noyau (Kernel Anti-Cheat : Easy Anti-Cheat, BattlEye, Vanguard)",
  "symptom": "Crash immédiat avec écran bleu PAGE_FAULT_IN_NONPAGED_AREA au lancement ou en cours de partie.",
  "cause": "",
  "solution": "Réinstaller proprement le composant anti-triche depuis son répertoire d'installation local et désactiver les logiciels d'émulation de périphériques virtuels.",
  "advanced": false
 },
 {
  "id": 280,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Infection par Rootkit de niveau noyau modifiant la table SSDT",
  "symptom": "Extinction spontanée de la machine dès qu'un outil de diagnostic (ex. Gestionnaire des tâches) est ouvert.",
  "cause": "",
  "solution": "Exécuter une analyse hors-ligne avec l'outil de détection de rootkits TDSSKiller ou réinstaller proprement Windows.",
  "advanced": false
 },
 {
  "id": 281,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Blocage de sécurité Windows Defender « Intégrité de la mémoire » (Hypervisor-Protected Code Integrity - HVCI)",
  "symptom": "Crash et arrêt complet lors du chargement d'un pilote tiers ancien non conforme aux normes HVCI.",
  "cause": "",
  "solution": "Désactiver temporairement l'intégrité de la mémoire dans Sécurité Windows > Sécurité des appareils > Isolation du noyau.",
  "advanced": false
 },
 {
  "id": 282,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Désynchronisation de la protection BitLocker lors d'une session active",
  "symptom": "Échec de lecture à chaud des clés de déchiffrement à la volée, écran bleu d'arrêt direct.",
  "cause": "",
  "solution": "Suspendre la protection BitLocker dans le Panneau de configuration, redémarrer, puis reprendre la protection pour réécrire les métadonnées.",
  "advanced": false
 },
 {
  "id": 283,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Infection par un cheval de Troie de type « Miner » (Cryptojacking silencieux)",
  "symptom": "Dès que l'utilisateur s'absente 2 minutes, le CPU s'emballe à 100 %, surchauffe et provoque une extinction d'urgence.",
  "cause": "",
  "solution": "Passer un scan approfondi avec Malwarebytes et inspecter les tâches planifiées masquées dans le système.",
  "advanced": false
 },
 {
  "id": 284,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Exploitation d'une faille de dépassement de tampon (Buffer Overflow) sur le service RPC",
  "symptom": "Arrêt net commandé à distance ou crash du processus réseau principal.",
  "cause": "",
  "solution": "Activer le Pare-feu Windows Defender sur tous les profils (Public et Privé) et appliquer les correctifs de sécurité Windows en attente.",
  "advanced": false
 },
 {
  "id": 285,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Filtrage réseau par injection WFP (Windows Filtering Platform) corrompu",
  "symptom": "Arrêt du PC dès la réception d'un paquet de données réseau spécifique.",
  "cause": "",
  "solution": "Réinitialiser la pile WFP et les règles de pare-feu : netsh advfirewall reset.",
  "advanced": false
 },
 {
  "id": 286,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Contrôle d'accès obligatoire (AppLocker / Stratégie de contrôle d'application) mal configuré",
  "symptom": "Windows bloque ses propres DLL indispensables et s'éteint sans message d'erreur.",
  "cause": "",
  "solution": "Désactiver le service Identité de l'application (AppIDSvc) en mode de secours pour récupérer la main.",
  "advanced": false
 },
 {
  "id": 287,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Infection du secteur d'amorçage virtuel VBR / chargeur UEFI corrompu",
  "symptom": "Windows s'éteint en session lors de l'accès à certaines partitions masquées.",
  "cause": "",
  "solution": "Réécrire les fichiers d'amorçage système via la commande : bcdboot C:\\Windows /l fr-fr /s S: /f UEFI (où S: est la partition ESP système).",
  "advanced": false
 },
 {
  "id": 288,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Pilote de sandbox de virtualisation (Windows Sandbox / WSL2) en panique",
  "symptom": "Crash de l'hôte Windows dès le démarrage de la machine virtuelle légère.",
  "cause": "",
  "solution": "Désactiver puis réactiver les fonctionnalités optionnelles Plateforme de machine virtuelle et Sous-système Windows pour Linux dans les fonctionnalités Windows.",
  "advanced": false
 },
 {
  "id": 289,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Certificat racine de confiance Windows corrompu ou expiré",
  "symptom": "Révocation de composants critiques du système d'exploitation entraînant le refus de démarrage des services maîtres.",
  "cause": "",
  "solution": "Télécharger et appliquer le package officiel de mise à jour des certificats racines Microsoft (Root Certificates Update).",
  "advanced": false
 },
 {
  "id": 290,
  "domain": "Pannes logicielles Windows",
  "category": "Sécurité, Antivirus, Malwares & Chiffrement",
  "title": "Logiciel d'espionnage / Spyware interceptant les interruptions de frappe clavier",
  "symptom": "Gel complet de la frappe suivi de l'extinction du PC après un délai d'inactivité.",
  "cause": "",
  "solution": "Nettoyer les extensions de navigateurs et démarrer un scan anti-malware autonome hors-ligne via clé USB.",
  "advanced": false
 },
 {
  "id": 291,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Conflit de versions dans les redistribuables Microsoft Visual C++",
  "symptom": "Erreur système 0xc000007b ou plantage violent de l'OS lors du lancement d'un exécutable.",
  "cause": "",
  "solution": "Désinstaller tous les composants Visual C++ présents et réinstaller le pack unifié officiel Visual C++ Redistributable All-in-One (x86 et x64 de 2005 à 2026).",
  "advanced": false
 },
 {
  "id": 292,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Fuite de mémoire (Memory Leak) massive d'un navigateur internet (Chrome/Edge/Firefox)",
  "symptom": "Consommation de 99 % de la RAM par un onglet défaillant conduisant au crash de l'interface graphique puis arrêt système.",
  "cause": "",
  "solution": "Activer la fonction intégrée « Économiseur de mémoire » dans les paramètres de performance du navigateur et désactiver les extensions instables.",
  "advanced": false
 },
 {
  "id": 293,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Superposition logicielle (Overlays) en conflit simultané (Discord, GeForce Experience, Steam, RivaTuner)",
  "symptom": "Arrêt brutal ou freeze lors du basculement d'une application 3D vers le bureau (Alt + Tab).",
  "cause": "",
  "solution": "Désactiver l'ensemble des modules d'overlay en jeu dans les réglages de chaque logiciel tiers.",
  "advanced": false
 },
 {
  "id": 294,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Conflit d'accès direct de deux logiciels de gestion de LED RGB aux bus matériels (SMBus)",
  "symptom": "Gel total de la machine dès le lancement synchronisé de deux outils (ex. iCUE et Armoury Crate).",
  "cause": "",
  "solution": "Désinstaller les multiples logiciels constructeurs de rétroéclairage et n'utiliser qu'un seul utilitaire centralisé compatible.",
  "advanced": false
 },
 {
  "id": 295,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Corruption de la bibliothèque multimédia FFmpeg / Codecs tiers installés",
  "symptom": "Crash instantané de l'Explorateur Windows (explorer.exe) au simple survol d'un dossier contenant des fichiers vidéo.",
  "cause": "",
  "solution": "Désinstaller les packs de codecs obsolètes (K-Lite Codec Pack mal configuré) et vider le cache des miniatures Windows avec cleanmgr.",
  "advanced": false
 },
 {
  "id": 296,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Incompatibilité du runtime .NET Framework avec une mise à jour d'application métier",
  "symptom": "Arrêt inattendu du service applicatif maître avec exception non gérée bloquant l'OS.",
  "cause": "",
  "solution": "Exécuter l'outil officiel de réparation Microsoft .NET Framework Repair Tool.",
  "advanced": false
 },
 {
  "id": 297,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Logiciel d'optimisation de performance / « Nettoyeur de registre » agressif (CCleaner, etc.)",
  "symptom": "Suppression de clés d'interface reliant les composants Windows, entraînant l'extinction automatique des processus hôtes.",
  "cause": "",
  "solution": "Restaurer la sauvegarde de registre réalisée avant le nettoyage ou utiliser un point de restauration système précédent.",
  "advanced": true
 },
 {
  "id": 298,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Conflit de capture d'écran matérielle (OBS Studio / Xbox Game Bar)",
  "symptom": "Écran bleu KERNEL_SECURITY_CHECK_FAILURE dès le démarrage d'un enregistrement d'écran.",
  "cause": "",
  "solution": "Modifier la méthode de capture dans OBS (passer de « Capture de jeu » à « Capture de fenêtre ») et mettre à jour le pilote d'encodage vidéo (NVENC/AMF).",
  "advanced": false
 },
 {
  "id": 299,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Logiciel de contrôle de ventilation ou de courbes de température tiers mal codé",
  "symptom": "L'application plante en tâche de fond, cesse de communiquer les consignes de refroidissement et provoque l'arrêt thermique de sécurité.",
  "cause": "",
  "solution": "Privilégier la gestion des courbes de ventilation directement dans le BIOS/UEFI de la carte mère au lieu de solutions logicielles Windows.",
  "advanced": true
 },
 {
  "id": 300,
  "domain": "Pannes logicielles Windows",
  "category": "Runtimes, Logiciels Applicatifs & Conflits Multimédias",
  "title": "Crash récurrent lié aux extensions de menu contextuel de l'Explorateur Windows",
  "symptom": "Le PC fige dès que l'utilisateur fait un clic droit sur un fichier ou sur le bureau.",
  "cause": "",
  "solution": "Utiliser l'outil ShellExView (NirSoft), masquer toutes les extensions Microsoft, et désactiver une par une les extensions tierces pour isoler et supprimer le module responsable.",
  "advanced": false
 },
 {
  "id": 301,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Outlook bloqué sur « Traitement en cours... » ou « Démarrage en cours... »",
  "symptom": "",
  "cause": "Profil de messagerie corrompu ou complément COM tiers instable au chargement.",
  "solution": "Lancer Outlook en mode sans échec (Win + R puis outlook.exe /safe), ouvrir Fichier > Options > Compléments, sélectionner Compléments COM puis désactiver les modules non Microsoft.",
  "advanced": true
 },
 {
  "id": 302,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Fichier de données Outlook (.PST ou .OST) corrompu",
  "symptom": "",
  "cause": "Coupure inopinée ou arrêt forcé de l'ordinateur pendant la synchronisation.",
  "solution": "Fermer Outlook, exécuter l'outil officiel scanpst.exe (situé dans C:\\Program Files\\Microsoft Office\\root\\Office16), sélectionner le fichier corrompu et cliquer sur Réparer.",
  "advanced": false
 },
 {
  "id": 303,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Outlook redemande le mot de passe en boucle sans valider l'accès",
  "symptom": "",
  "cause": "Jetons d'authentification moderne (ADAL/MSAL) corrompus dans le cache Windows.",
  "solution": "Ouvrir le Gestionnaire d'identification Windows, aller dans Informations d'identification Windows et supprimer toutes les entrées préfixées par MicrosoftOffice16_Data et MS.Outlook.",
  "advanced": false
 },
 {
  "id": 304,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Recherche Outlook inactive ou renvoyant « Aucun résultat »",
  "symptom": "",
  "cause": "Catalogue d'indexation Windows Search corrompu ou désynchronisé d'Outlook.",
  "solution": "Ouvrir Panneau de configuration > Options d'indexation > Avancé, puis cliquer sur Reconstruire l'index.",
  "advanced": false
 },
 {
  "id": 305,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Boîte d'envoi Outlook bloquée : les e-mails ne partent plus",
  "symptom": "",
  "cause": "Pièce jointe dépassant la limite autorisée par le serveur SMTP ou mode hors connexion activé.",
  "solution": "Basculer dans l'onglet Envoi/Réception, désactiver Travailler en mode hors connexion, déplacer le message lourd vers les brouillons et supprimer la pièce jointe.",
  "advanced": false
 },
 {
  "id": 306,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Erreur de synchronisation IMAP 0x800CCC0E",
  "symptom": "",
  "cause": "Blocage du port ou chiffrement SSL/TLS mal configuré.",
  "solution": "Vérifier les paramètres du compte : IMAP entrant port 993 (SSL/TLS), SMTP sortant port 465 ou 587 (STARTTLS) avec authentification cochée.",
  "advanced": false
 },
 {
  "id": 307,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Courriers indésirables : e-mails légitimes envoyés directement dans les spams",
  "symptom": "",
  "cause": "Filtre SmartScreen Outlook trop agressif ou adresse expéditeur blacklistée par erreur.",
  "solution": "Clic droit sur le message > Courrier indésirable > Ne jamais bloquer l'expéditeur ou modifier le niveau de filtrage dans les options de courrier indésirable.",
  "advanced": false
 },
 {
  "id": 308,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Carnet d'adresses / Saisie semi-automatique corrompue dans Outlook",
  "symptom": "",
  "cause": "Cache .NK2 ou stream d'autocomplétion altéré.",
  "solution": "Aller dans Fichier > Options > Courrier > section Envoi des messages > cliquer sur Vider la liste de saisie semi-automatique.",
  "advanced": false
 },
 {
  "id": 309,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Pièces jointes PDF ou images impossibles à prévisualiser dans Outlook",
  "symptom": "",
  "cause": "Gestionnaire de prévisualisation (Previewer) désactivé dans le Registre.",
  "solution": "Dans les options d'Outlook, vérifier le Gestionnaire de pièces jointes > cocher Activer l'aperçu des pièces jointes.",
  "advanced": true
 },
 {
  "id": 310,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Taille maximale du fichier PST atteinte (bloqué à 50 Go)",
  "symptom": "",
  "cause": "Quota limite par défaut du format Unicode atteint.",
  "solution": "Créer ou ajuster les valeurs DWORD MaxLargeFileSize (ex. 71680 pour 70 Go) et WarnLargeFileSize dans HKCU\\Software\\Microsoft\\Office\\16.0\\Outlook\\PST.",
  "advanced": true
 },
 {
  "id": 311,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Règles de boîte de réception désactivées ou affichant une erreur d'exécution",
  "symptom": "",
  "cause": "Règle pointant vers un dossier local supprimé ou quota des règles dépassé sur Exchange.",
  "solution": "Ouvrir Gérer les règles et alertes, supprimer les règles orphelines portant la mention « Erreur ».",
  "advanced": false
 },
 {
  "id": 312,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Signature électronique qui ne s'insère plus automatiquement",
  "symptom": "",
  "cause": "Dossier local Signatures corrompu ou association de compte perdue.",
  "solution": "Réassocier la signature par défaut au compte dans Fichier > Options > Courrier > Signatures.",
  "advanced": false
 },
 {
  "id": 313,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Décalage horaire sur les rendez-vous du calendrier Outlook",
  "symptom": "",
  "cause": "Fuseau horaire du client Outlook différent de celui configuré sur Windows.",
  "solution": "Aligner le fuseau horaire dans Options Outlook > Calendrier > Fuseaux horaires sur celui de l'horloge système.",
  "advanced": false
 },
 {
  "id": 314,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Erreur « Outlook utilise une version antérieure d'un fichier de données »",
  "symptom": "",
  "cause": "Incohérence lors de la mise à niveau d'un ancien profil POP vers un protocole moderne.",
  "solution": "Créer un profil de messagerie neuf et propre via la console control mlcfg32.cpl.",
  "advanced": false
 },
 {
  "id": 315,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Courriers légitimes basculés automatiquement dans le dossier Spams",
  "symptom": "",
  "cause": "Filtre SmartScreen interne ou règle d'expéditeur bloqué activée par erreur.",
  "solution": "Clic droit sur l'e-mail > Courrier indésirable > Ne jamais bloquer l'expéditeur et contrôler la liste dans Options du courrier indésirable.",
  "advanced": false
 },
 {
  "id": 316,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Liste de saisie semi-automatique des adresses corrompue",
  "symptom": "",
  "cause": "Fichier cache de flux d'adresses défaillant (fichiers .NK2 ou Stream).",
  "solution": "Aller dans Fichier > Options > Courrier > section Envoi des messages, puis cliquer sur Vider la liste de saisie semi-automatique.",
  "advanced": false
 },
 {
  "id": 317,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Aperçu des pièces jointes impossible dans le volet de lecture",
  "symptom": "",
  "cause": "Contrôleur de prévisualisation (Previewer) désactivé ou clé de registre endommagée.",
  "solution": "Dans Options d'Outlook > Centre de gestion de la confidentialité > Paramètres du Centre... > Gestion des pièces jointes > cocher Activer l'aperçu des pièces jointes.",
  "advanced": true
 },
 {
  "id": 318,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Règles de tri désactivées avec mention « Erreur d'exécution »",
  "symptom": "",
  "cause": "Règle pointant vers un dossier de destination supprimé ou limite de 256 Ko de règles Exchange dépassée.",
  "solution": "Ouvrir Gérer les règles et alertes, supprimer les règles invalides signalées par un point d'exclamation rouge.",
  "advanced": false
 },
 {
  "id": 319,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Signature électronique absente lors de la création d'un message",
  "symptom": "",
  "cause": "Profil utilisateur désassocié de la signature par défaut.",
  "solution": "Reconfigurer l'attribution automatique dans Fichier > Options > Courrier > Signatures en sélectionnant le bon compte de messagerie.",
  "advanced": false
 },
 {
  "id": 320,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Décalage horaire systématique sur les réunions du calendrier",
  "symptom": "",
  "cause": "Fuseau horaire Outlook distinct de celui de l'horloge Windows.",
  "solution": "Aligner le fuseau horaire dans Options > Calendrier > Fuseaux horaires sur celui défini dans les réglages système Windows.",
  "advanced": false
 },
 {
  "id": 321,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Impossible de cliquer sur les liens Web dans les e-mails",
  "symptom": "",
  "cause": "Association du protocole HTTP/HTTPS rompue suite à la désinstallation d'un navigateur tiers.",
  "solution": "Réinitialiser le navigateur par défaut dans les paramètres Windows ou exécuter : reg add \"HKCU\\Software\\Classes\\.html\" /ve /d \"htmlfile\" /f",
  "advanced": true
 },
 {
  "id": 322,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Dossiers de messagerie IMAP introuvables ou invisibles",
  "symptom": "",
  "cause": "Arborescence non abonnée au niveau du serveur distant.",
  "solution": "Clic droit sur la boîte de réception > Dossiers IMAP > cliquer sur Requête, cocher les dossiers manquants et valider S'abonner.",
  "advanced": false
 },
 {
  "id": 323,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Outlook plante dès la tentative d'impression d'un e-mail",
  "symptom": "",
  "cause": "Fichier de paramètres d'impression corrompu (Outlprnt).",
  "solution": "Fermer Outlook, supprimer ou renommer le fichier Outlprnt situé dans %AppData%\\Microsoft\\Outlook\\.",
  "advanced": false
 },
 {
  "id": 324,
  "domain": "Windows et Office",
  "category": "Suite Office : Outlook & Messagerie",
  "title": "Mode « Travail hors connexion » impossible à désactiver",
  "symptom": "",
  "cause": "Problème de résolution DNS ou passerelle de messagerie non joignable.",
  "solution": "Vider le cache de résolution DNS local en invite de commande : ipconfig /flushdns",
  "advanced": false
 },
 {
  "id": 325,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Word plante dès l'ouverture d'un document vierge",
  "symptom": "",
  "cause": "Modèle de document de base Normal.dotm corrompu.",
  "solution": "Fermer Word, naviguer vers %AppData%\\Microsoft\\Templates\\ et supprimer ou renommer le fichier Normal.dotm (Word en recréera un sain au démarrage).",
  "advanced": false
 },
 {
  "id": 326,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Excel bloqué sur « Traitement en cours... » lors de l'ouverture d'un classeur",
  "symptom": "",
  "cause": "Calcul automatique itératif sur des formules matricielles complexes ou liaisons externes rompues.",
  "solution": "Démarrer Excel sans document, aller dans Formules > Options de calcul > sélectionner Manuel, puis réouvrir le classeur.",
  "advanced": false
 },
 {
  "id": 327,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Excel ouvre une page totalement grise et vide au double-clic sur un fichier",
  "symptom": "",
  "cause": "Fonctionnalité d'échange dynamique de données (DDE) bloquée.",
  "solution": "Dans Excel, aller dans Fichier > Options > Options avancées > section Général, et décocher Ignorer les autres applications qui utilisent l'échange dynamique de données (DDE).",
  "advanced": false
 },
 {
  "id": 328,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Document Word verrouillé : « Ce fichier est utilisé par un autre utilisateur »",
  "symptom": "",
  "cause": "Fichier temporaire propriétaire orphelin masqué (préfixé par ~$).",
  "solution": "Activer l'affichage des fichiers cachés dans l'Explorateur Windows et supprimer les fichiers temporaires commençant par ~$ dans le dossier du document.",
  "advanced": false
 },
 {
  "id": 329,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "PowerPoint refuse d'insérer ou de lire une vidéo",
  "symptom": "",
  "cause": "Conflit de codec d'accélération matérielle.",
  "solution": "Dans PowerPoint : Fichier > Options > Options avancées > section Affichage > cocher Désactiver l'accélération graphique matérielle.",
  "advanced": false
 },
 {
  "id": 330,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Erreur d'exécution VBA 1004 ou plantage des macros Excel",
  "symptom": "",
  "cause": "Blocage de sécurité de l'attribut « Mot du Web » (Mark of the Web) sur les macros téléchargées.",
  "solution": "Clic droit sur le fichier .xlsm > Propriétés > cocher la case Débloquer en bas, puis cliquer sur Appliquer.",
  "advanced": false
 },
 {
  "id": 331,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Message « Mémoire insuffisante pour afficher complètement la feuille » dans Excel",
  "symptom": "",
  "cause": "Utilisation de la version Office 32 bits saturée à 2 Go de RAM sur un tableau volumineux.",
  "solution": "Désinstaller la suite Office 32 bits et installer la version 64 bits officielle.",
  "advanced": false
 },
 {
  "id": 332,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Caractères spéciaux et formules mathématiques transformés en carrés dans Word",
  "symptom": "",
  "cause": "Police vectorielle système Cambria Math désinstallée ou corrompue.",
  "solution": "Réinstaller les polices système par défaut depuis le dossier d'installation Windows (C:\\Windows\\Fonts).",
  "advanced": false
 },
 {
  "id": 333,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Plantage d'Office lors d'un copier-coller",
  "symptom": "",
  "cause": "Conflit avec l'historique du presse-papier système.",
  "solution": "Réinitialiser le presse-papier (Win + V > Effacer tout) ou désactiver temporairement l'historique du presse-papier dans les réglages système.",
  "advanced": false
 },
 {
  "id": 334,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Word : correction automatique et dictionnaire soulignent tous les mots en rouge",
  "symptom": "",
  "cause": "Langue de vérification globale forcée sur une mauvaise variante linguistique.",
  "solution": "Sélectionner tout le texte (Ctrl + A), aller dans l'onglet Révision > Langue > Définir la langue de vérification > choisir Français et décocher Détecter automatiquement la langue.",
  "advanced": false
 },
 {
  "id": 335,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Document ouvert systématiquement en lecture seule",
  "symptom": "",
  "cause": "Paramètre d'Affichage protégé trop restrictif.",
  "solution": "Dans le logiciel concerné : Centre de gestion de la confidentialité > Affichage protégé > désactiver la protection pour les fichiers issus d'Internet.",
  "advanced": false
 },
 {
  "id": 336,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "PowerPoint affiche des polices différentes lors du changement d'ordinateur",
  "symptom": "",
  "cause": "Polices personnalisées non intégrées au fichier de présentation.",
  "solution": "Dans PowerPoint, aller dans Fichier > Options > Enregistrement > cocher Incorporer les polices dans le fichier.",
  "advanced": true
 },
 {
  "id": 337,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Formules Excel affichant le texte de la formule au lieu du résultat numérique",
  "symptom": "",
  "cause": "Format de la cellule défini en « Texte » ou raccourci d'affichage des formules actif.",
  "solution": "Passer le format de cellule en Standard, appuyer sur F2 puis Entrée, ou basculer le mode via Ctrl + \".",
  "advanced": false
 },
 {
  "id": 338,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Crash immédiat d'Excel lors de la manipulation d'un Tableau Croisé Dynamique (TCD)",
  "symptom": "",
  "cause": "Cache de données du classeur saturé ou références de colonnes vides.",
  "solution": "Nettoyer la plage source, supprimer les lignes vides et forcer l'actualisation du cache dans les paramètres du TCD.",
  "advanced": false
 },
 {
  "id": 339,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Word perd la mise en page lors de l'enregistrement en PDF",
  "symptom": "",
  "cause": "Pilote d'impression virtuel Microsoft Print to PDF défaillant.",
  "solution": "Désactiver puis réactiver Microsoft Print to PDF dans les Fonctionnalités facultatives de Windows.",
  "advanced": false
 },
 {
  "id": 340,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Message d'erreur « Composant ActiveX non sécurisé » à l'ouverture d'un fichier Office",
  "symptom": "",
  "cause": "Paramètres de sécurité stricts bloquant les contrôles formulaires anciens.",
  "solution": "Régler les autorisations ActiveX dans le Centre de gestion de la confidentialité sur M'avertir avant d'activer tous les contrôles.",
  "advanced": false
 },
 {
  "id": 341,
  "domain": "Windows et Office",
  "category": "Suite Office : Word, Excel & PowerPoint",
  "title": "Tableaux Excel apparaissant décalés ou tronqués à l'impression physique",
  "symptom": "",
  "cause": "Moteur de rendu GDI mal calibré sur le format de page par défaut du pilote d'impression.",
  "solution": "Dans Mise en page, ajuster l'échelle à Ajuster à 1 page en largeur.",
  "advanced": false
 },
 {
  "id": 342,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Bandeau « Produit sans licence » ou « Activation nécessaire »",
  "symptom": "",
  "cause": "Conflit de clés résiduelles ou service de gestion des licences arrêté.",
  "solution": "Ouvrir l'invite de commande administrateur dans le dossier Office : cscript \"C:\\Program Files\\Microsoft Office\\Office16\\OSPP.VBS\" /dstatus cscript \"C:\\Program Files\\Microsoft Office\\Office16\\OSPP.VBS\" /unpkey:XXXXX cscript \"C:\\Program Files\\Microsoft Office\\Office16\\OSPP.VBS\" /act",
  "advanced": false
 },
 {
  "id": 343,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Erreur de compte Office : « Des problèmes sont survenus avec votre compte »",
  "symptom": "",
  "cause": "Cache d'authentification Azure AD / Microsoft 365 désynchronisé sur le poste.",
  "solution": "Déconnecter le compte dans Fichier > Compte, puis supprimer le compte professionnel dans Paramètres Windows > Comptes > Accès professionnel ou scolaire.",
  "advanced": false
 },
 {
  "id": 344,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "OneDrive bloqué sur « Traitement des modifications en cours... »",
  "symptom": "",
  "cause": "Fichier verrouillé par un processus tiers ou cache de synchronisation saturé.",
  "solution": "Réinitialiser complètement le moteur OneDrive en exécutant : %localappdata%\\Microsoft\\OneDrive\\onedrive.exe /reset",
  "advanced": false
 },
 {
  "id": 345,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Conflit de synchronisation OneDrive : création de doublons avec le nom du PC",
  "symptom": "",
  "cause": "Enregistrement simultané local et cloud sans fusion des flux.",
  "solution": "Ouvrir les paramètres OneDrive > onglet Office > cocher Utiliser les applications Office pour synchroniser les fichiers Office ouverts.",
  "advanced": true
 },
 {
  "id": 346,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Microsoft Teams bloqué sur un écran blanc au lancement",
  "symptom": "",
  "cause": "Cache local WebView2 ou cache client Teams altéré.",
  "solution": "Fermer Teams, supprimer l'intégralité des dossiers dans %appdata%\\Microsoft\\Teams ou %localappdata%\\Packages\\MSTeams_8wekyb3d8bbwe\\LocalCache.",
  "advanced": false
 },
 {
  "id": 347,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Microphone ou caméra non détecté dans Teams mais fonctionnel sous Windows",
  "symptom": "",
  "cause": "Autorisation d'accès de l'application de bureau bloquée dans les stratégies de confidentialité.",
  "solution": "Aller dans Paramètres Windows > Confidentialité et sécurité > Microphone > activer Autoriser les applications de bureau à accéder à votre microphone.",
  "advanced": false
 },
 {
  "id": 348,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Partage d'écran Teams affichant un écran noir aux autres participants",
  "symptom": "",
  "cause": "Conflit avec le basculement automatique du GPU sur PC portable à double carte graphique.",
  "solution": "Forcer Teams à tourner sur la carte graphique intégrée (faible consommation) dans les paramètres graphiques de Windows.",
  "advanced": false
 },
 {
  "id": 349,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "OneDrive supprime les fichiers locaux lors du passage en « Fichiers à la demande »",
  "symptom": "",
  "cause": "Fonction Libérer de l'espace exécutée sans compréhension du statut cloud.",
  "solution": "Clic droit sur le dossier OneDrive > Toujours conserver sur cet appareil pour forcer le stockage local permanent.",
  "advanced": false
 },
 {
  "id": 350,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Erreur d'installation Office 365 : code d'erreur 30088-4 ou 0-2031",
  "symptom": "",
  "cause": "Fichiers résiduels d'une précédente installation « Démarrer en un clic » (Click-to-Run).",
  "solution": "Utiliser l'outil officiel de désinstallation Microsoft SaRA (Assistant Support et Récupération) pour purger le système avant réinstallation.",
  "advanced": false
 },
 {
  "id": 351,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Impossible d'ouvrir un document stocké sur SharePoint / OneDrive via l'application bureau",
  "symptom": "",
  "cause": "Conflit d'identifiants entre le compte Windows local et le compte d'organisation M365.",
  "solution": "Effacer le cache du Centre de téléchargement Office dans les options avancées de téléversement.",
  "advanced": false
 },
 {
  "id": 352,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Mises à jour Office bloquées ou générant une erreur 30015-11",
  "symptom": "",
  "cause": "Service C2R (ClickToRunSvc) arrêté ou inaccessible.",
  "solution": "Ouvrir services.msc, localiser Service Démarrer en un clic de Microsoft Office, régler le démarrage sur Automatique et démarrer le service.",
  "advanced": false
 },
 {
  "id": 353,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Teams se lance en double exemplaire au démarrage du PC (Classique et Nouveau)",
  "symptom": "",
  "cause": "Coexistence résiduelle de deux paquets d'installation distincts.",
  "solution": "Désinstaller l'ancienne version « Teams Machine-Wide Installer » et « Microsoft Teams (classic) » depuis le panneau des applications.",
  "advanced": false
 },
 {
  "id": 354,
  "domain": "Windows et Office",
  "category": "Suite Office : Licence, OneDrive & Teams",
  "title": "Perte de l'historique des versions sur un document Office partagé",
  "symptom": "",
  "cause": "Fichier enregistré sous un format legacy incompatible (.doc ou .xls) au lieu des formats modernes (.docx, .xlsx).",
  "solution": "Convertir le fichier au format OpenXML moderne via Fichier > Enregistrer sous > choisir le format standard XML.",
  "advanced": true
 },
 {
  "id": 355,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Explorateur Windows (explorer.exe) plante au clic droit sur le bureau",
  "symptom": "",
  "cause": "Extension de menu contextuel tierce (Shell Extension) obsolète ou mal programmée.",
  "solution": "Télécharger l'outil ShellExView, masquer les extensions Microsoft, et désactiver une par une les extensions non signées pour isoler la fautive.",
  "advanced": false
 },
 {
  "id": 356,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Menu Démarrer et barre des tâches totalement figés ou inactifs",
  "symptom": "",
  "cause": "Paquets de l'infrastructure d'application moderne (AppX) corrompus.",
  "solution": "Ouvrir PowerShell en administrateur et réenregistrer les composants : Get-AppXPackage -AllUsers | Foreach {Add-AppxPackage -DisableDevelopmentMode -Register \"$($_.InstallLocation)\\AppXManifest.xml\"}",
  "advanced": true
 },
 {
  "id": 357,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Boucle de « Préparation de la réparation automatique » au boot",
  "symptom": "",
  "cause": "BCD corrompu ou ruche système inaccessible sur la partition de démarrage.",
  "solution": "Démarrer sur WinRE, ouvrir l'invite de commande et taper : bootrec /fixmbr bootrec /fixboot bootrec /rebuildbcd",
  "advanced": true
 },
 {
  "id": 358,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Erreur d'écran bleu CRITICAL_PROCESS_DIED en cours de travail",
  "symptom": "",
  "cause": "Processus d'arrière-plan fondamental (csrss.exe ou smss.exe) arrêté brutalement.",
  "solution": "Exécuter une analyse et réparation d'intégrité globale : DISM /Online /Cleanup-Image /RestoreHealth sfc /scannow",
  "advanced": true
 },
 {
  "id": 359,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Écran noir avec uniquement le pointeur de souris visible après connexion",
  "symptom": "",
  "cause": "Le processus d'environnement utilisateur n'a pas été exécuté par le Registre.",
  "solution": "Taper Ctrl + Maj + Échap, cliquer sur Fichier > Exécuter une nouvelle tâche, saisir regedit et vérifier que la clé HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\Shell contient strictement la valeur explorer.exe.",
  "advanced": true
 },
 {
  "id": 360,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Message d'erreur « Fichier ou répertoire endommagé et illisible »",
  "symptom": "",
  "cause": "Incohérence dans la table des fichiers maîtres NTFS ($MFT).",
  "solution": "Lancer une vérification avec correction du lecteur concerné : chkdsk C: /f /r",
  "advanced": false
 },
 {
  "id": 361,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Démarrage extrêmement lent : utilisation disque bloquée à 100 %",
  "symptom": "",
  "cause": "Dysfonctionnement du service d'indexation prédictive SysMain sur le volume système.",
  "solution": "Désactiver le service dans services.msc : double-clic sur SysMain, passer le démarrage sur Désactivé et arrêter le service.",
  "advanced": false
 },
 {
  "id": 362,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Impossible de supprimer un fichier : « Action impossible car le fichier est ouvert »",
  "symptom": "",
  "cause": "Handle système orphelin maintenu actif par un processus d'arrière-plan.",
  "solution": "Utiliser l'outil Process Explorer (Sysinternals) : faire Ctrl + F, rechercher le nom du fichier et cliquer sur Close Handle.",
  "advanced": false
 },
 {
  "id": 363,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Icônes du bureau devenues blanches ou génériques",
  "symptom": "",
  "cause": "Base de données du cache des icônes (IconCache.db) corrompue.",
  "solution": "Tuer explorer.exe, puis supprimer via la ligne de commande le fichier %LocalAppData%\\IconCache.db et relancer l'Explorateur.",
  "advanced": false
 },
 {
  "id": 364,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Fenêtre système bloquée en dehors de l'écran visible",
  "symptom": "",
  "cause": "Déconnexion d'un écran secondaire mémorisée par la géométrie de fenêtre.",
  "solution": "Sélectionner l'application dans la barre des tâches, presser Alt + Espace, appuyer sur la touche L (Déplacer) et recentrer avec les flèches du clavier.",
  "advanced": false
 },
 {
  "id": 365,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Session utilisateur qui se verrouille automatiquement après quelques secondes",
  "symptom": "",
  "cause": "Délai d'expiration du verrouillage de la console sans assistance trop bas.",
  "solution": "Débloquer l'attribut d'alimentation via le Registre dans HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\PowerSettings\\7516b95f-f776-4464-8c53-06167f40cc99\\8EC4B3A5-6868-48c2-BE75-4F3044BE58A7 en passant Attributes à 2, puis régler le délai dans les options d'énergie.",
  "advanced": true
 },
 {
  "id": 366,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Association de fichiers corrompue : tous les fichiers .exe s'ouvrent avec le Bloc-notes",
  "symptom": "",
  "cause": "Ruche d'association des extensions de fichiers du Registre altérée.",
  "solution": "Fusionner un fichier correctif .reg contenant la configuration par défaut pour la clé HKEY_CLASSES_ROOT\\.exe.",
  "advanced": true
 },
 {
  "id": 367,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Historique des fichiers récents bloqué ou refusant de se mettre à jour",
  "symptom": "",
  "cause": "Cache des éléments récents saturé ou corrompu dans AutomaticDestinations.",
  "solution": "Purger les dossiers de raccourcis récents : del /F /Q %AppData%\\Microsoft\\Windows\\Recent\\AutomaticDestinations\\*",
  "advanced": false
 },
 {
  "id": 368,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "L'outil de capture d'écran Windows (Win + Maj + S) ne s'ouvre plus",
  "symptom": "",
  "cause": "Certificat de signature de l'application moderne expiré ou composant corrompu.",
  "solution": "Réinstaller l'outil Capture d'écran et croquis depuis le Microsoft Store ou réparer l'application dans les Paramètres.",
  "advanced": false
 },
 {
  "id": 369,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Corbeille corrompue : message d'erreur à chaque suppression",
  "symptom": "",
  "cause": "Fichier d'index $Recycle.Bin du volume C: endommagé.",
  "solution": "Réinitialiser la corbeille en exécutant en invite administrateur : rd /s /q C:\\$Recycle.Bin",
  "advanced": false
 },
 {
  "id": 370,
  "domain": "Windows et Office",
  "category": "Système Windows : Démarrage, Fichiers & Shell",
  "title": "Raccourcis clavier Windows (Win + E, Win + R) inopérants",
  "symptom": "",
  "cause": "Stratégie de registre désactivant les touches d'accès rapide Windows.",
  "solution": "Vérifier dans HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer que la valeur NoWinKeys est inexistante ou réglée sur 0.",
  "advanced": true
 },
 {
  "id": 371,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Windows Update affiche l'erreur 0x80070002 ou 0x80070003",
  "symptom": "",
  "cause": "Fichiers d'installation téléchargés incomplets ou corrompus.",
  "solution": "Arrêter les services et vider le cache de téléchargement : net stop wuauserv net stop bits net stop cryptsvc rd /s /q C:\\Windows\\SoftwareDistribution net start cryptsvc net start bits net start wuauserv",
  "advanced": false
 },
 {
  "id": 372,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Erreur Windows Update 0x800f081f (Fichiers sources introuvables)",
  "symptom": "",
  "cause": "Magasin de composants WinSxS dégradé.",
  "solution": "Réparer le magasin en précisant une image saine : DISM /Online /Cleanup-Image /RestoreHealth",
  "advanced": true
 },
 {
  "id": 373,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Mise à jour bloquée à un pourcentage fixe (ex. 20 % ou 100 %) pendant des heures",
  "symptom": "",
  "cause": "Verrouillage d'écriture par un fichier .inf de pilote tiers en attente.",
  "solution": "Redémarrer en mode sans échec pour forcer la fin de l'écriture ou exécuter l'utilitaire de résolution des problèmes Windows Update.",
  "advanced": true
 },
 {
  "id": 374,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Installation en échec avec l'erreur 0x80240034",
  "symptom": "",
  "cause": "Défaillance de communication avec les serveurs de métadonnées WSUS / Microsoft Update.",
  "solution": "Réinitialiser le catalogue Winsock et les tables IP via : netsh winsock reset",
  "advanced": false
 },
 {
  "id": 375,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Mise à jour de sécurité refusant de s'installer : erreur 0x80070643",
  "symptom": "",
  "cause": "Espace libre insuffisant sur la partition de récupération système (WinRE).",
  "solution": "Étendre manuellement la taille de la partition de récupération via diskpart pour lui allouer au minimum 1 Go d'espace.",
  "advanced": true
 },
 {
  "id": 376,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Windows Update installe un pilote matériel instable sans consentement",
  "symptom": "",
  "cause": "Stratégie d'inclusion des pilotes activée par défaut dans Windows Update.",
  "solution": "Activer la stratégie dans gpedit.msc : Configuration ordinateur > Composants Windows > Windows Update > Ne pas inclure les pilotes avec les mises à jour de Windows.",
  "advanced": true
 },
 {
  "id": 377,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Redémarrages intempestifs répétés pour des mises à jour pendant les heures de travail",
  "symptom": "",
  "cause": "Période d'activité système mal configurée.",
  "solution": "Régler les Heures d'activité dans les paramètres de Windows Update sur la plage horaire réelle d'utilisation (jusqu'à 18h d'amplitude).",
  "advanced": false
 },
 {
  "id": 378,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Erreur 0x80070422 lors de la recherche de mises à jour",
  "symptom": "",
  "cause": "Le service Windows Update est désactivé dans la console système.",
  "solution": "Ouvrir services.msc, repasser le type de démarrage du service Windows Update sur Manuel ou Automatique, puis démarrer le service.",
  "advanced": false
 },
 {
  "id": 379,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Boucle infinie « Annulation des modifications » au redémarrage",
  "symptom": "",
  "cause": "Fichier de transaction de mise à jour bloqué en attente.",
  "solution": "Démarrer sur WinRE, ouvrir l'invite de commande et supprimer le fichier d'exécution : del /f /q C:\\Windows\\WinSxS\\pending.xml",
  "advanced": true
 },
 {
  "id": 380,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Composants",
  "title": "Échec de mise à jour des applications via le Microsoft Store (0x80073D02)",
  "symptom": "",
  "cause": "Données de cache du Windows Store altérées.",
  "solution": "Exécuter la commande wsreset.exe dans la boîte de dialogue Exécuter.",
  "advanced": false
 },
 {
  "id": 381,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Icône réseau avec globe terrestre : « Connecté, pas d'accès Internet »",
  "symptom": "",
  "cause": "Échec de test de la sonde NCSI (Network Connectivity Status Indicator) vers les serveurs Microsoft.",
  "solution": "Réinitialiser les adresses IP et vider le cache DNS : ipconfig /release ipconfig /renew ipconfig /flushdns",
  "advanced": false
 },
 {
  "id": 382,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Résolution des noms de domaine impossible (Serveur DNS introuvable)",
  "symptom": "",
  "cause": "Cache du résolveur DNS local pollué ou serveur DNS du FAI défaillant.",
  "solution": "Configurer manuellement des serveurs DNS sécurisés (ex. Cloudflare 1.1.1.1 et 1.0.0.1 ou Google 8.8.8.8).",
  "advanced": false
 },
 {
  "id": 383,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Partage de dossiers réseau Windows (SMB) inaccessible : erreur 0x80070035",
  "symptom": "",
  "cause": "Désactivation des connexions invitées non sécurisées sur les versions récentes de Windows.",
  "solution": "Activer l'option dans gpedit.msc : Modèles d'administration > Réseau > Station de travail Lanman > Activer les ouvertures de session invité non sécurisées.",
  "advanced": true
 },
 {
  "id": 384,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Pare-feu Windows Defender bloque une application professionnelle légitime",
  "symptom": "",
  "cause": "Règle de trafic entrant restrictive appliquée automatiquement au profil privé.",
  "solution": "Ouvrir le Pare-feu avec fonctions avancées de sécurité, créer une Règle de trafic entrant autorisant le port ou le binaire de l'application.",
  "advanced": false
 },
 {
  "id": 385,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Erreur d'isolation du noyau : « Pilote incompatible empêche l'activation »",
  "symptom": "",
  "cause": "Présence d'anciens pilotes système incompatibles avec la technologie HVCI.",
  "solution": "Identifier le fichier .sys signalé, localiser son nom de publication via pnputil /enum-drivers et le supprimer via : pnputil /delete-driver oemXX.inf /uninstall /force",
  "advanced": false
 },
 {
  "id": 386,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Connexion Bureau à distance (RDP) refusée : erreur de chiffrement CredSSP",
  "symptom": "",
  "cause": "Écart de stratégie de mise à jour de sécurité CredSSP entre le client et le serveur distant.",
  "solution": "Mettre à jour le poste distant ou configurer temporairement la stratégie Correction de l'oracle de chiffrement sur Vulnérable dans gpedit.msc.",
  "advanced": true
 },
 {
  "id": 387,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "BitLocker demande le code de déverrouillage de récupération à chaque démarrage",
  "symptom": "",
  "cause": "Registres de configuration de plateforme (PCR) modifiés suite à un changement de micrologiciel ou désynchronisation TPM.",
  "solution": "Ouvrir l'invite administrateur, suspendre puis réactiver la protection : manage-bde -protectors -disable C: manage-bde -protectors -enable C:",
  "advanced": true
 },
 {
  "id": 388,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Erreur d'approbation de relation entre cette station de travail et le domaine principal",
  "symptom": "",
  "cause": "Mot de passe du compte machine désynchronisé dans l'annuaire Active Directory.",
  "solution": "Sortir le PC du domaine en le basculant en groupe de travail (WORKGROUP), redémarrer, puis le réintégrer au domaine.",
  "advanced": false
 },
 {
  "id": 389,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Windows Defender désactivé et impossible à réactiver (grisé)",
  "symptom": "",
  "cause": "Reste d'une clé de registre d'antivirus tiers ou infection masquée ayant forcé la clé DisableAntiSpyware.",
  "solution": "Supprimer la valeur DisableAntiSpyware dans HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender.",
  "advanced": true
 },
 {
  "id": 390,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Code PIN Windows Hello inaccessible : « Un problème est survenu »",
  "symptom": "",
  "cause": "Clés cryptographiques locales corrompues dans le conteneur NGC.",
  "solution": "Prendre le contrôle du dossier système caché C:\\Windows\\ServiceProfiles\\LocalService\\AppData\\Local\\Microsoft\\NGC, supprimer son contenu et recréer un code PIN.",
  "advanced": false
 },
 {
  "id": 391,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Certificats Web révoqués ou dates système affichant « Connexion non privée »",
  "symptom": "",
  "cause": "Horloge locale de Windows désynchronisée de plus de 5 minutes par rapport au temps universel (NTP).",
  "solution": "Forcer la resynchronisation de l'horloge : w32tm /resync",
  "advanced": false
 },
 {
  "id": 392,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Conflit de ports TCP locaux bloquant le démarrage des logiciels serveurs",
  "symptom": "",
  "cause": "Plage dynamique de ports réservée par Hyper-V / WSL2 excluant le port requis.",
  "solution": "Identifier l'occupation via netstat -ano et redéfinir la plage de démarrage du service natif d'exclusion.",
  "advanced": false
 },
 {
  "id": 393,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Pare-feu & Authentification",
  "title": "Le VPN Windows natif ne parvient pas à établir la liaison (Erreur 809)",
  "symptom": "",
  "cause": "Blocage NAT-T de négociation IPsec derrière un routeur réseau local.",
  "solution": "Ajouter la valeur DWORD AssumeUDPEncapsulationContextOnSendRule avec la donnée 2 dans HKLM\\SYSTEM\\CurrentControlSet\\Services\\PolicyAgent.",
  "advanced": true
 },
 {
  "id": 394,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Erreur 0xc000007b au lancement d'un jeu ou logiciel de rendu",
  "symptom": "",
  "cause": "Conflit critique entre bibliothèques dynamiques DLL 32 bits et 64 bits dans System32 et SysWOW64.",
  "solution": "Réinstaller l'ensemble des redistribuables officiels via le pack unifié Visual C++ Redistributable All-in-One (de 2005 à 2022+).",
  "advanced": false
 },
 {
  "id": 395,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Message « Fichier DLL manquant » (ex. VCRUNTIME140.dll ou MSVCP140.dll)",
  "symptom": "",
  "cause": "Environnement de développement d'exécution C++ absent ou corrompu par une désinstallation tierce.",
  "solution": "Télécharger et installer la version x86 et x64 du composant redistribuable Visual Studio correspondant.",
  "advanced": false
 },
 {
  "id": 396,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Applications plantant avec des erreurs d'exception .NET Framework",
  "symptom": "",
  "cause": "Composants d'exécution .NET corrompus suite à une mise à niveau d'OS.",
  "solution": "Exécuter l'utilitaire officiel de réparation Microsoft .NET Framework Repair Tool.",
  "advanced": false
 },
 {
  "id": 397,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Fuite de mémoire vive du processus d'hébergement svchost.exe",
  "symptom": "",
  "cause": "Service système d'arrière-plan bloqué dans une boucle d'allocation infinie.",
  "solution": "Identifier le service précis via le Gestionnaire des tâches (clic droit sur la ligne > Accéder aux services) pour le réinitialiser.",
  "advanced": false
 },
 {
  "id": 398,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Consommation anormale du CPU par System Settings Broker ou RuntimeBroker.exe",
  "symptom": "",
  "cause": "Boucle de notification d'astuces Windows envoyée en arrière-plan.",
  "solution": "Aller dans Paramètres > Système > Notifications, et décocher Obtenir des conseils et des suggestions lors de l'utilisation de Windows.",
  "advanced": false
 },
 {
  "id": 399,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Programmes qui se lancent avec un affichage flou sur écran haute résolution (HiDPI)",
  "symptom": "",
  "cause": "Mise à l'échelle DPI logicielle non prise en charge par les anciens programmes Win32.",
  "solution": "Clic droit sur l'exécutable > Propriétés > Compatibilité > Modifier les paramètres PPP élevés > cocher Remplacer le comportement de mise à l'échelle PPP élevée.",
  "advanced": false
 },
 {
  "id": 400,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Erreur « Mémoire virtuelle insuffisante » sans surcharge physique de la RAM",
  "symptom": "",
  "cause": "Fichier d'échange (pagefile.sys) configuré sur une taille fixe trop basse ou corrompu.",
  "solution": "Régler la pagination sur Gérer automatiquement la taille du fichier d'échange pour tous les lecteurs dans les performances avancées du système.",
  "advanced": false
 },
 {
  "id": 401,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Logiciel refusant de s'installer : « Une autre installation est déjà en cours »",
  "symptom": "",
  "cause": "Processus d'installation Microsoft Installer (msiexec.exe) resté orphelin en arrière-plan.",
  "solution": "Ouvrir le Gestionnaire des tâches, tuer tous les processus nommés msiexec.exe, ou taper dans l'invite :",
  "advanced": false
 },
 {
  "id": 402,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Impossibilité d'exécuter des scripts PowerShell : « L'exécution de scripts est désactivée »",
  "symptom": "",
  "cause": "Stratégie de sécurité d'exécution (ExecutionPolicy) réglée par défaut sur Restricted.",
  "solution": "Ouvrir PowerShell en administrateur et modifier la stratégie :",
  "advanced": false
 },
 {
  "id": 403,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Crash systématique des jeux ou logiciels 3D au retour bureau (Alt + Tab)",
  "symptom": "",
  "cause": "Conflit avec la planification de processeur graphique à accélération matérielle (HAGS).",
  "solution": "Désactiver l'option Planification de GPU à accélération matérielle dans les Paramètres graphiques de Windows.",
  "advanced": false
 },
 {
  "id": 404,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Logiciel impossible à désinstaller : paquet d'installation source manquant",
  "symptom": "",
  "cause": "Clé de désinstallation orpheline résiduelle dans le registre système.",
  "solution": "Utiliser l'utilitaire officiel de résolution des problèmes d'installation et de désinstallation de programmes de Microsoft pour purger la clé.",
  "advanced": true
 },
 {
  "id": 405,
  "domain": "Windows et Office",
  "category": "Performances, Runtimes & Registre Applicatif",
  "title": "Crash complet de la pile logicielle multimédia (DirectX / DirectSound)",
  "symptom": "",
  "cause": "Conflit entre les couches d'amélioration audio logicielles (Enhancements) et les API de rendu.",
  "solution": "Ouvrir les propriétés du périphérique de lecture son, aller dans l'onglet Améliorations et cocher la case Désactiver toutes les améliorations sonores.",
  "advanced": false
 },
 {
  "id": 406,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Outlook redemande le mot de passe en boucle (Authentification moderne bloquée)",
  "symptom": "",
  "cause": "Jetons ADAL/MSAL ou identifiants mis en cache expirés ou corrompus.",
  "solution": "Ouvrir le Gestionnaire d'identification, aller dans Informations d'identification Windows et supprimer toutes les lignes contenant MicrosoftOffice16_Data et MS.Outlook.",
  "advanced": false
 },
 {
  "id": 407,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "E-mails bloqués dans la Boîte d'envoi",
  "symptom": "",
  "cause": "Pièce jointe dépassant la taille limite SMTP autorisée ou mode déconnecté actif.",
  "solution": "Dans l'onglet Envoi/Réception, désactiver Travailler hors connexion, déplacer le message dans Brouillons et retirer la pièce jointe trop lourde.",
  "advanced": false
 },
 {
  "id": 408,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Courriers légitimes basculés d'office dans les spams",
  "symptom": "",
  "cause": "Filtre anti-spam local mal étalonné ou règle d'expéditeur bloqué activée par mégarde.",
  "solution": "Clic droit sur le courriel > Courrier indésirable > Ne jamais bloquer l'expéditeur.",
  "advanced": false
 },
 {
  "id": 409,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Règles de messagerie désactivées avec mention « Erreur »",
  "symptom": "",
  "cause": "Règle pointant vers un dossier local introuvable ou dépassement de la limite Exchange de 256 Ko.",
  "solution": "Ouvrir Gérer les règles et les alertes, supprimer les règles orphelines marquées d'une croix rouge.",
  "advanced": false
 },
 {
  "id": 410,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Signature absente lors de la rédaction d'un message",
  "symptom": "",
  "cause": "Perte de l'association de la signature par défaut au compte.",
  "solution": "Aller dans Fichier > Options > Courrier > Signatures et réattribuer la signature aux nouveaux messages et réponses.",
  "advanced": false
 },
 {
  "id": 411,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Décalage horaire systématique des rendez-vous du calendrier",
  "symptom": "",
  "cause": "Fuseau horaire Outlook non synchronisé avec celui de Windows.",
  "solution": "Aligner le fuseau dans Options > Calendrier > Fuseaux horaires sur l'heure système locale.",
  "advanced": false
 },
 {
  "id": 412,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Impossible d'ouvrir les liens hypertextes dans les e-mails",
  "symptom": "",
  "cause": "Association du protocole URL corrompue après la désinstallation d'un navigateur.",
  "solution": "Exécuter en invite de commande : reg add \"HKCU\\Software\\Classes\\.html\" /ve /d \"htmlfile\" /f",
  "advanced": true
 },
 {
  "id": 413,
  "domain": "Windows et Office",
  "category": "Microsoft Outlook & Messagerie",
  "title": "Crash lors de l'impression d'un e-mail depuis Outlook",
  "symptom": "",
  "cause": "Fichier de configuration d'impression corrompu.",
  "solution": "Fermer Outlook et supprimer le fichier caché : del /f /q \"%APPDATA%\\Microsoft\\Outlook\\Outlprnt\"",
  "advanced": false
 },
 {
  "id": 414,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Word plante dès l'ouverture d'une page blanche",
  "symptom": "",
  "cause": "Modèle de base global corrompu.",
  "solution": "Supprimer ou renommer le fichier Normal.dotm : del /f /q \"%APPDATA%\\Microsoft\\Templates\\Normal.dotm\"",
  "advanced": false
 },
 {
  "id": 415,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Excel ouvre une interface grise sans afficher le tableau",
  "symptom": "",
  "cause": "Option d'échange dynamique de données (DDE) bloquée.",
  "solution": "Dans Excel : Fichier > Options > Options avancées > section Général > décocher Ignorer les autres applications qui utilisent l'échange dynamique de données (DDE).",
  "advanced": false
 },
 {
  "id": 416,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Erreur d'exécution VBA 1004 / Blocage des macros téléchargées",
  "symptom": "",
  "cause": "Blocage de sécurité de l'attribut « Mark of the Web ».",
  "solution": "Clic droit sur le fichier .xlsm > Propriétés > cocher la case Débloquer en bas, puis cliquer sur Appliquer.",
  "advanced": false
 },
 {
  "id": 417,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Message « Mémoire insuffisante » dans Excel",
  "symptom": "",
  "cause": "Utilisation d'une version Office 32 bits limitée à 2 Go d'espace d'adressage virtuel.",
  "solution": "Désinstaller la version 32 bits et installer Microsoft Office en version 64 bits native.",
  "advanced": false
 },
 {
  "id": 418,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Symboles et formules mathématiques changés en rectangles dans Word",
  "symptom": "",
  "cause": "Police vectorielle système Cambria Math manquante ou corrompue.",
  "solution": "Réinstaller les polices système par défaut depuis le répertoire d'installation Windows (C:\\Windows\\Fonts).",
  "advanced": false
 },
 {
  "id": 419,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Dictionnaire Word soulignant tous les mots en rouge",
  "symptom": "",
  "cause": "Mauvaise langue de vérification globale forcée sur le document.",
  "solution": "Faire Ctrl + A > onglet Révision > Langue > Définir la langue de vérification > sélectionner le français et décocher Détecter automatiquement la langue.",
  "advanced": false
 },
 {
  "id": 420,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Polices personnalisées modifiées lors du changement de PC dans PowerPoint",
  "symptom": "",
  "cause": "Polices non incorporées au conteneur du fichier.",
  "solution": "Ouvrir Options > Enregistrement > cocher Incorporer les polices dans le fichier.",
  "advanced": true
 },
 {
  "id": 421,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Cellule Excel affichant le texte de la formule au lieu du résultat",
  "symptom": "",
  "cause": "Format de la cellule défini en texte ou mode d'affichage des formules actif.",
  "solution": "Passer la cellule au format Standard, appuyer sur F2 puis Entrée, ou basculer avec le raccourci Ctrl + \".",
  "advanced": false
 },
 {
  "id": 422,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Crash lors de l'actualisation d'un Tableau Croisé Dynamique",
  "symptom": "",
  "cause": "Lignes vides ou références de colonnes corrompues dans la plage source.",
  "solution": "Redéfinir la plage de données source dans les paramètres du tableau pour exclure les colonnes sans en-tête.",
  "advanced": false
 },
 {
  "id": 423,
  "domain": "Windows et Office",
  "category": "Microsoft Word, Excel & PowerPoint",
  "title": "Décalage de mise en page lors de l'export en PDF depuis Word",
  "symptom": "",
  "cause": "Pilote d'impression virtuel Microsoft défaillant.",
  "solution": "Désactiver puis réactiver le composant Microsoft Print to PDF dans les Fonctionnalités facultatives de Windows.",
  "advanced": false
 },
 {
  "id": 424,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "OneDrive crée des fichiers doublons avec le nom du PC",
  "symptom": "",
  "cause": "Conflit de synchronisation simultanée entre le cache local Office et le cloud.",
  "solution": "Ouvrir les paramètres OneDrive > onglet Office > cocher Utiliser les applications Office pour synchroniser les fichiers Office ouverts.",
  "advanced": false
 },
 {
  "id": 425,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Microphone ou webcam non détecté dans Teams",
  "symptom": "",
  "cause": "Autorisation d'accès de l'application bloquée par la confidentialité Windows.",
  "solution": "Ouvrir Paramètres > Confidentialité et sécurité > Microphone (et Caméra) > activer Autoriser les applications de bureau à accéder à votre microphone.",
  "advanced": false
 },
 {
  "id": 426,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Partage d'écran Teams affichant un écran noir",
  "symptom": "",
  "cause": "Conflit de basculement de carte graphique sur PC portable hybride.",
  "solution": "Assigner l'application Teams au mode « Économie d'énergie » (GPU intégré) dans les Paramètres graphiques de Windows.",
  "advanced": false
 },
 {
  "id": 427,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Fichiers supprimés en local lors de l'activation des fichiers à la demande OneDrive",
  "symptom": "",
  "cause": "Bascule en mode dématérialisé mal interprétée.",
  "solution": "Clic droit sur le dossier racine OneDrive > choisir Toujours conserver sur cet appareil.",
  "advanced": false
 },
 {
  "id": 428,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Erreur d'installation Office Click-to-Run 30088-4 ou 0-2031",
  "symptom": "",
  "cause": "Éléments résiduels bloquants d'une ancienne installation.",
  "solution": "Exécuter l'outil officiel de nettoyage Microsoft SaRA (Assistant Support et Récupération) pour purger les traces Office avant réinstallation.",
  "advanced": false
 },
 {
  "id": 429,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Impossible d'ouvrir un document SharePoint dans l'application de bureau",
  "symptom": "",
  "cause": "Identifiants en conflit entre le compte Windows local et le tenant Microsoft 365.",
  "solution": "Vider le cache du Centre de téléchargement Office via les options avancées de téléversement.",
  "advanced": false
 },
 {
  "id": 430,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Service Démarrer en un clic (C2R) arrêté : erreur 30015-11",
  "symptom": "",
  "cause": "Service ClickToRunSvc désactivé ou en échec.",
  "solution": "Ouvrir services.msc, localiser le Service Démarrer en un clic de Microsoft Office, régler sur Automatique et démarrer le service.",
  "advanced": false
 },
 {
  "id": 431,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Teams se lance en double exemplaire (ancien et nouveau client)",
  "symptom": "",
  "cause": "Présence résiduelle du paquet Teams Machine-Wide Installer.",
  "solution": "Désinstaller l'ancien paquet classique depuis la liste des applications installées.",
  "advanced": false
 },
 {
  "id": 432,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Historique des versions indisponible sur un fichier Office partagé",
  "symptom": "",
  "cause": "Fichier enregistré au format legacy binaire (.doc, .xls) incompatible.",
  "solution": "Convertir le classeur ou document vers les extensions OpenXML modernes (.docx, .xlsx).",
  "advanced": false
 },
 {
  "id": 433,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Erreur d'enregistrement automatique indisponible dans Word/Excel",
  "symptom": "",
  "cause": "Document non hébergé directement sur la racine OneDrive ou SharePoint.",
  "solution": "Enregistrer le fichier directement sur l'espace cloud rattaché au compte M365 actif.",
  "advanced": true
 },
 {
  "id": 434,
  "domain": "Windows et Office",
  "category": "Licences Office, OneDrive & Microsoft Teams",
  "title": "Module complémentaire désactivé automatiquement par sécurité par Outlook",
  "symptom": "",
  "cause": "Temps de chargement du module supérieur à 1 seconde au démarrage.",
  "solution": "Aller dans Fichier > Gérer les compléments COM lents et désactivés > cliquer sur Toujours activer ce complément.",
  "advanced": false
 },
 {
  "id": 435,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "BSOD DRIVER_IRQL_NOT_LESS_OR_EQUAL (ndis.sys) sous charge réseau",
  "symptom": "",
  "cause": "Pilote de carte réseau Ethernet ou Wi-Fi corrompu.",
  "solution": "Désinstaller le périphérique depuis le Gestionnaire de périphériques et installer le pilote natif du fabricant de la puce.",
  "advanced": false
 },
 {
  "id": 436,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Gel complet de l'OS lors de l'insertion d'un périphérique USB",
  "symptom": "",
  "cause": "Filtre de classe USB corrompu bloquant la pile d'E/S.",
  "solution": "Supprimer les valeurs UpperFilters et LowerFilters dans le registre :",
  "advanced": true
 },
 {
  "id": 437,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "BSOD INACCESSIBLE_BOOT_DEVICE suite à une mise à jour",
  "symptom": "",
  "cause": "Pilote de contrôleur AHCI/RAID non synchronisé avec le noyau.",
  "solution": "Démarrer sur WinRE et purger le pilote problématique : dism /Image:C:\\ /Remove-Driver /Driver:oemX.inf",
  "advanced": true
 },
 {
  "id": 438,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Écran bleu provoqué par le pilote Bluetooth (bthport.sys)",
  "symptom": "",
  "cause": "Échec de gestion de veille de la pile Bluetooth.",
  "solution": "Décocher l'option Autoriser l'ordinateur à éteindre ce périphérique pour économiser l'énergie dans les propriétés de la puce Bluetooth.",
  "advanced": false
 },
 {
  "id": 439,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "BSOD causé par un pilote de virtualisation tiers (vboxdrv.sys)",
  "symptom": "",
  "cause": "Conflit avec la fonctionnalité d'isolation du noyau de Windows.",
  "solution": "Mettre à niveau le logiciel de virtualisation ou désactiver temporairement l'intégrité de la mémoire dans les réglages de sécurité.",
  "advanced": false
 },
 {
  "id": 440,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Extinction subite liée au pilote thermique Intel DPTF / AMD PPM",
  "symptom": "",
  "cause": "Fausses alertes thermiques transmises à Windows par une version de pilote obsolète.",
  "solution": "Réinstaller le package de pilotes du chipset de la carte mère.",
  "advanced": true
 },
 {
  "id": 441,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Crash provoqué par un pilote de manette générique (xusb21.sys)",
  "symptom": "",
  "cause": "Interruption anormale lors de l'envoi du signal de vibration.",
  "solution": "Attribuer manuellement le pilote officiel « Périphérique Xbox 360 pour Windows » dans le Gestionnaire de périphériques.",
  "advanced": false
 },
 {
  "id": 442,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Crash noyau provoqué par le sous-système d'impression (win32kfull.sys)",
  "symptom": "",
  "cause": "Pilote d'imprimante V3 obsolète accédant directement à l'espace noyau.",
  "solution": "Supprimer le pilote via printmanagement.msc et installer un pilote conforme V4 / Type 4.",
  "advanced": false
 },
 {
  "id": 443,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Écran bleu causé par un adaptateur de tunnel VPN (wintun.sys)",
  "symptom": "",
  "cause": "Corruption de la table de routage virtuelle.",
  "solution": "Réinitialiser la couche de transport réseau : netsh winsock reset netsh int ip reset",
  "advanced": false
 },
 {
  "id": 444,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Plantage du service d'authentification biométrique (WbioSrvc.exe)",
  "symptom": "",
  "cause": "Base de données biométrique Windows Hello corrompue.",
  "solution": "Arrêter le service biométrique et vider le dossier : del /f /q C:\\Windows\\System32\\WinBioDatabase\\*",
  "advanced": false
 },
 {
  "id": 445,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Crash système à l'ouverture de la webcam (stream.sys)",
  "symptom": "",
  "cause": "Conflit d'accès mémoire entre plusieurs applications vidéo en arrière-plan.",
  "solution": "Révoquer puis réautoriser l'accès aux caméras dans les Paramètres de confidentialité et sécurité.",
  "advanced": false
 },
 {
  "id": 446,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "BSOD provoqué par un outil d'overclocking logiciel au démarrage",
  "symptom": "",
  "cause": "Application d'un profil instable par un service noyau au boot.",
  "solution": "Démarrer en mode sans échec et désactiver les services associés (ex. AMDRyzenMasterDriver ou XTUservice).",
  "advanced": true
 },
 {
  "id": 447,
  "domain": "Windows et Office",
  "category": "Pilotes, Affichage & Noyau Windows",
  "title": "Crash lors du débranchement à chaud d'un disque externe (UASP)",
  "symptom": "",
  "cause": "Cache d'écriture non vidé avant la rupture de communication.",
  "solution": "Dans le Gestionnaire de périphériques > clic droit sur le disque > Stratégies > choisir Suppression rapide.",
  "advanced": false
 },
 {
  "id": 448,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Corruption des fichiers maîtres du noyau (ntoskrnl.exe)",
  "symptom": "",
  "cause": "Erreurs d'écriture disque ou arrêt brutal.",
  "solution": "Exécuter l'analyse et la réparation des fichiers système protégés : sfc /scannow",
  "advanced": false
 },
 {
  "id": 449,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Magasin de composants Windows corrompu (WinSxS)",
  "symptom": "",
  "cause": "Mises à jour partielles ou interrompues.",
  "solution": "Réparer l'image système avec l'utilitaire DISM : DISM /Online /Cleanup-Image /RestoreHealth",
  "advanced": true
 },
 {
  "id": 450,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Fichier de mémoire virtuelle (pagefile.sys) corrompu",
  "symptom": "",
  "cause": "Écriture incomplète sur le disque lors d'un crash antérieur.",
  "solution": "Désactiver temporairement le fichier d'échange dans les paramètres de performance système, redémarrer le PC, puis le réactiver en gestion automatique.",
  "advanced": false
 },
 {
  "id": 451,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Fichier d'hibernation (hiberfil.sys) défaillant",
  "symptom": "",
  "cause": "Image de reprise corrompue bloquant la sortie de veille.",
  "solution": "Réinitialiser le fichier d'hibernation : powercfg /h off powercfg /h on",
  "advanced": false
 },
 {
  "id": 452,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Boucle de redémarrage causée par le Démarrage Rapide (Fast Startup)",
  "symptom": "",
  "cause": "Incohérence de l'état système entre le noyau mis en cache et l'état réel.",
  "solution": "Désactiver le démarrage rapide dans le Panneau de configuration > Options d'alimentation > Choisir l'action des boutons d'alimentation.",
  "advanced": false
 },
 {
  "id": 453,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Données de configuration de démarrage (BCD) corrompues",
  "symptom": "",
  "cause": "Corruption du secteur de boot suite à une coupure ou une partition dégradée.",
  "solution": "Démarrer sur WinRE et reconstruire le magasin BCD : bootrec /rebuildbcd",
  "advanced": true
 },
 {
  "id": 454,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Explorateur Windows (explorer.exe) plantant au clic droit",
  "symptom": "",
  "cause": "Extension de menu contextuel tierce défaillante.",
  "solution": "Utiliser l'outil ShellExView, masquer les composants Microsoft, et désactiver successivement les extensions tierces pour isoler la responsable.",
  "advanced": false
 },
 {
  "id": 455,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Écran noir avec uniquement le curseur visible après l'ouverture de session",
  "symptom": "",
  "cause": "Le shell utilisateur n'est pas initialisé par la clé Winlogon.",
  "solution": "Ouvrir le Gestionnaire des tâches (Ctrl + Maj + Échap), lancer regedit et vérifier que la clé HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon\\Shell est définie strictement sur explorer.exe.",
  "advanced": true
 },
 {
  "id": 456,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Utilisation disque bloquée à 100 % causée par SysMain",
  "symptom": "",
  "cause": "Indexation prédictive SuperFetch en boucle sur les volumes de stockage.",
  "solution": "Ouvrir services.msc, localiser le service SysMain, passer le démarrage sur Désactivé et arrêter le service.",
  "advanced": false
 },
 {
  "id": 457,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Session basculée sur un profil temporaire",
  "symptom": "",
  "cause": "Échec de lecture du fichier NTUSER.DAT, création d'une clé .bak dans le Registre.",
  "solution": "Dans HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\ProfileList, localiser l'entrée avec .bak, retirer le suffixe .bak et vérifier le chemin dans ProfileImagePath.",
  "advanced": true
 },
 {
  "id": 458,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Fichier impossible à supprimer : « Fichier ouvert dans un autre programme »",
  "symptom": "",
  "cause": "Handle système orphelin non libéré par un processus d'arrière-plan.",
  "solution": "Lancer l'outil Process Explorer (Sysinternals), presser Ctrl + F, chercher le nom du fichier et fermer le handle bloquant.",
  "advanced": false
 },
 {
  "id": 459,
  "domain": "Windows et Office",
  "category": "Fichiers Système, Réparation & Démarrage Windows",
  "title": "Corbeille corrompue provoquant une erreur de suppression",
  "symptom": "",
  "cause": "Répertoire masqué $Recycle.Bin endommagé sur le lecteur.",
  "solution": "Réinitialiser la corbeille système : rd /s /q C:\\$Recycle.Bin",
  "advanced": false
 },
 {
  "id": 460,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Erreur de mise à jour 0x800f081f",
  "symptom": "",
  "cause": "Fichiers sources introuvables dans le magasin de composants.",
  "solution": "Réparer le magasin en précisant une image saine comme source : DISM /Online /Cleanup-Image /RestoreHealth",
  "advanced": true
 },
 {
  "id": 461,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Échec de mise à jour de sécurité avec l'erreur 0x80070643",
  "symptom": "",
  "cause": "Espace insuffisant sur la partition de récupération WinRE pour appliquer le patch.",
  "solution": "Étendre manuellement la taille de la partition WinRE d'au moins 500 Mo via diskpart.",
  "advanced": true
 },
 {
  "id": 462,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Windows Update forçant l'installation de pilotes non désirés",
  "symptom": "",
  "cause": "Inclusion automatique des pilotes activée par défaut.",
  "solution": "Ouvrir gpedit.msc > Configuration ordinateur > Modèles d'administration > Composants Windows > Windows Update > activer Ne pas inclure les pilotes avec les mises à jour de Windows.",
  "advanced": true
 },
 {
  "id": 463,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Erreur 0x80070422 lors du lancement d'une mise à jour",
  "symptom": "",
  "cause": "Service Windows Update désactivé dans la console système.",
  "solution": "Ouvrir services.msc, passer le service Windows Update en démarrage Manuel ou Automatique et démarrer le service.",
  "advanced": false
 },
 {
  "id": 464,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Échec de mise à jour du Microsoft Store (0x80073D02)",
  "symptom": "",
  "cause": "Cache temporaire du magasin Windows corrompu.",
  "solution": "Réinitialiser le store en exécutant la commande :",
  "advanced": false
 },
 {
  "id": 465,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Arrêt impromptu du processus d'authentification (lsass.exe)",
  "symptom": "",
  "cause": "Injection de code malveillant ou régression liée à un correctif de sécurité.",
  "solution": "Désinstaller la dernière mise à jour cumulative depuis WinRE via la commande : wusa /uninstall /kb:XXXXXXX",
  "advanced": true
 },
 {
  "id": 466,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Service Spouleur d'impression (spoolsv.exe) saturant le CPU",
  "symptom": "",
  "cause": "File d'attente d'impression bloquée sur un travail corrompu.",
  "solution": "Vider le répertoire des spools : net stop spooler del /q /f /s \"%systemroot%\\System32\\Spool\\Printers\\*.*\" net start spooler",
  "advanced": false
 },
 {
  "id": 467,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Fuite de mémoire dans le Gestionnaire de fenêtres du bureau (dwm.exe)",
  "symptom": "",
  "cause": "Bug de gestion de mémoire avec la planification GPU accélérée (HAGS).",
  "solution": "Désactiver l'option Planification de GPU à accélération matérielle dans les paramètres graphiques avancés de Windows.",
  "advanced": false
 },
 {
  "id": 468,
  "domain": "Windows et Office",
  "category": "Mises à Jour Windows Update & Services",
  "title": "Crash répété du service de chiffrement Windows (CryptSvc)",
  "symptom": "",
  "cause": "Base de données de catalogue de signatures système corrompue.",
  "solution": "Arrêter le service et renommer le dossier : net stop cryptsvc",
  "advanced": false
 },
 {
  "id": 469,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Icône « Connecté, pas d'accès Internet » (NCSI)",
  "symptom": "",
  "cause": "Sonde réseau bloquée par un serveur DNS défaillant.",
  "solution": "Réinitialiser les baux IP et le cache de résolution : ipconfig /release ipconfig /renew ipconfig /flushdns",
  "advanced": false
 },
 {
  "id": 470,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Erreurs de certificats HTTPS sur les navigateurs Web",
  "symptom": "",
  "cause": "Horloge locale système désynchronisée de plus de 5 minutes par rapport au temps universel.",
  "solution": "Forcer la synchronisation avec le serveur de temps officiel : w32tm /resync",
  "advanced": false
 },
 {
  "id": 471,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Erreur d'application 0xc000007b au démarrage d'un logiciel",
  "symptom": "",
  "cause": "Mélange accidentel de bibliothèques DLL 32 bits et 64 bits dans les répertoires System32 et SysWOW64.",
  "solution": "Réinstaller l'ensemble des bibliothèques officielles via le pack complet Visual C++ Redistributable All-in-One (x86 et x64).",
  "advanced": false
 },
 {
  "id": 472,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Applications crashant avec des erreurs .NET Framework",
  "symptom": "",
  "cause": "Couche d'exécution .NET corrompue.",
  "solution": "Exécuter l'outil officiel de réparation Microsoft .NET Framework Repair Tool.",
  "advanced": false
 },
 {
  "id": 473,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Consommation anormale du CPU par RuntimeBroker.exe",
  "symptom": "",
  "cause": "Boucle d'envoi des astuces et suggestions Windows en arrière-plan.",
  "solution": "Désactiver l'option dans Paramètres > Système > Notifications > décocher Obtenir des conseils et des suggestions lors de l'utilisation de Windows.",
  "advanced": false
 },
 {
  "id": 474,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Blocage de l'exécution des scripts sous PowerShell",
  "symptom": "",
  "cause": "Stratégie d'exécution définie sur Restricted par défaut.",
  "solution": "Autoriser les scripts signés localement :",
  "advanced": false
 },
 {
  "id": 475,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Impossible d'installer une application : « Une autre installation est en cours »",
  "symptom": "",
  "cause": "Processus du moteur d'installation resté orphelin en tâche de fond.",
  "solution": "Arrêter de force le processus bloquant :",
  "advanced": false
 },
 {
  "id": 476,
  "domain": "Windows et Office",
  "category": "Réseau, Sécurité, Runtimes & Environnement",
  "title": "Crash complet de la pile logicielle audio sous charge applicative",
  "symptom": "",
  "cause": "Traitement audio logiciel tiers (Enhancements) incompatible créant une saturation de la mémoire tampon.",
  "solution": "Ouvrir les propriétés du périphérique de lecture audio, onglet Améliorations, et cocher Désactiver toutes les améliorations sonores.",
  "advanced": false
 }
];
