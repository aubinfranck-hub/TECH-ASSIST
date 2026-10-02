# Décisions (D1 à D8)

Suivi des arbitrages listés dans le cahier des charges. Toutes les valeurs
chiffrées sont en base (`pricing_plans`, RF-41) et modifiables sans
redéploiement depuis l'administration.

| # | Sujet | Statut | Choix retenu |
|---|---|---|---|
| D1 | Client Windows : maison ou base ouverte | **Tranché** | RustDesk auto-hébergé (voir `docs/lot-l2-remote.md`) |
| D2 | Tarifs particuliers | **Tranché** (cahier des charges) | 500 / 2 000 / 5 000 FCFA à l'acte ; complété par D9 (1re assistance offerte + abonnement) |
| D3 | Agrégateur Mobile Money | **Ouvert** | Confirmation manuelle par un technicien en attendant |
| D4 | Contrôle Android : guidage seul ou accessibilité dès le départ | **Ouvert** | À trancher au Lot L3 |
| D5 | Techniciens partenaires payés à la session | **Tranché** (cahier des charges) | Part de la plateforme et statut juridique restent à fixer |
| D6 | Nom de marque et domaine | **Tranché (par défaut)** | "Tech Assist" conservé (déjà utilisé partout dans le code et les documents) |
| D7 | Paliers d'abonnement PME | **Tranché (par défaut)** | Voir tableau ci-dessous |
| D8 | Visites sur place : forfaits ou devis | **Tranché (par défaut)** | Forfaits fixes par type d'intervention (voir tableau) |
| D9 | Modes d'assistance et abonnement particulier | **Tranché** (demande du porteur) | Agent IA par défaut + technicien humain ; 1re assistance offerte (e-mail vérifié + appareil) ; abonnement 10 000 FCFA/mois ; tout dans l'application, le site est le miroir |
| D10 | Infrastructure et parc d'entreprise (« administrateur IT IA ») | **Proposé — non commencé** | Connecteurs par constructeur, passerelle sur site, espace société, validation humaine : voir D10 plus bas |

Les décisions marquées « par défaut » sont des choix raisonnables pour
avancer, pas des arbitrages métier définitifs — à valider ou ajuster
librement (un changement de prix ne demande qu'une modification en admin,
pas de nouveau déploiement).

## D7 — Paliers PME (au-dessus du forfait d'entrée)

| Palier | Prix/mois | Postes couverts | Assistances incluses | Réponse garantie | Technicien attitré | Rapport mensuel |
|---|---|---|---|---|---|---|
| Essentiel | 9 900 FCFA | 5 | 3 | 24h | Non | Non |
| Pro | 24 900 FCFA | 15 | 10 | 4h | Oui | Non |
| Entreprise | 49 900 FCFA | 40 | Illimitées | 1h | Oui | Oui |

Au-delà du quota inclus, chaque assistance supplémentaire est facturée au
tarif à l'acte de l'abonné (RP-06).

## D8 — Visites sur place

| Intervention | Prix | Remarque |
|---|---|---|
| Diagnostic réseau / WiFi | 5 000 FCFA | Zone Abidjan intra-muros ; +2 000 FCFA hors zone |
| Réinstallation système | 10 000 FCFA | Sauvegarde préalable avec accord écrit (RV-07) |
| Installation matériel / imprimante | 5 000 FCFA | |
| Mise en service d'un parc (PME) | Sur devis | À partir de 10 postes |

## D9 — Agent IA / technicien humain, assistance offerte, abonnement

Demande du porteur du projet (2 octobre 2026) : deux modes d'assistance
(dépannage ou aide sur un logiciel), **l'agent IA est le mode principal**, le
technicien humain reste une option. **Tout se fait dans l'application ; le site
n'en est que le miroir** (présentation, téléchargement, paiement d'une commande).

| Règle | Valeur |
|---|---|
| Mode par défaut | Agent IA (`ia`) ; technicien humain (`humain`) au choix |
| Assistance offerte | 1 par personne, 30 min, 0 FCFA (`assistance_offerte`) |
| Ensuite | Abonnement 10 000 FCFA / 30 jours (`abonnement_mensuel`), assistances illimitées |
| Paiement | Mobile Money, confirmé à la main par un technicien (D3) ; l'abonnement s'active à la confirmation |
| Renouvellement avant échéance | Prolonge la période en cours (pas de perte de jours) |

**Identification : l'application, pas le site.** Chaque installation s'enregistre
(`POST /api/app/register`) avec un identifiant d'installation, la plateforme,
une empreinte matérielle et un **e-mail vérifié par code à 6 chiffres**
(`POST /api/app/email-code`). Le serveur connaît donc, en base, qui a déjà
utilisé son assistance offerte (`app_installs.free_offer_used_at`).

**Garanties côté serveur** (`apps/api/src/routes/app.ts`) :
- l'offre est unique par e-mail **normalisé** (minuscules, sans `+alias`, points
  Gmail ignorés) **et** par empreinte matérielle : réinstaller, changer d'alias
  ou d'adresse sur le même appareil ne redonne pas l'offre ;
- les domaines d'e-mails jetables sont refusés ; le code est stocké haché
  (HMAC), valable 10 min, 5 essais, 5 codes / 15 min, 60 s entre deux envois ;
- l'abonnement est rattaché à l'e-mail (il survit à une réinstallation) ;
- la couverture (offre / abonnement) est calculée par l'API à chaque demande,
  jamais choisie par le client ; les formules à 0 FCFA ne sont pas commandables
  via `/api/orders` ; deux demandes simultanées ne donnent qu'une offre
  (verrous consultatifs PostgreSQL) ;
- le jeton de l'application (audience `tech-assist-app`) n'ouvre pas les routes
  techniciens, et inversement.

**Agent IA.** Un agent local (`apps/agent`, voir `docs/agent.md`) tourne sur
l'appareil du client et couvre **tous les services Windows** (son, impression, réseau,
mises à jour, Bluetooth, recherche, heure, ou un service désigné par son nom) : il
observe, propose chaque correction, attend le « oui » du client, agit, vérifie, et journalise chaque étape côté serveur
(`POST /api/app/sessions/:id/events`). Tant que `AI_AGENT_ENABLED` n'est pas à
`true`, une demande « IA » est servie par un technicien (la session garde
`requested_mode = 'ia'`). Les sessions `mode = 'ia'` n'entrent pas dans la file
des techniciens ; l'agent (événement `escalated`) ou le client
(`POST /api/sessions/:id/escalate`) peut passer à un technicien.

**Trois rôles dans l'agent** (demande du porteur) : *maintenance* (analyse, gravité, bouton « Réparer mon PC »), *IT à la demande* (serveur, lecteur réseau, imprimante, installation de logiciels d'un catalogue fermé) et *formation* (Windows, Office, métiers, niveaux 1 à 4, capture d'écran). Niveaux d'autorisation : lecture (sans accord), réparation (accord par action), sensible (point de restauration + accord) ; mots de passe, comptes, domaine, bureau à distance : jamais automatisés. Détail et limites : `docs/agent.md`.

**Limites connues.**
- L'empreinte matérielle est fournie par l'application : un client malveillant
  peut la falsifier. Elle est un frein, pas une preuve ; l'e-mail vérifié reste
  la clé principale. Piste : attestation de l'appareil (Play Integrity / TPM).
- Un utilisateur déterminé peut créer plusieurs adresses e-mail réelles et
  changer d'appareil. Le coût d'une assistance offerte (30 min) borne ce risque.
- La vérification par e-mail exige un SMTP configuré (`SMTP_*`) : sans lui, la
  production refuse d'envoyer des codes (erreur explicite, pas de contournement).

## D10 — Infrastructure et parc d'entreprise (proposé, non commencé)

Le porteur veut que « AI PC » devienne aussi un administrateur IT : serveurs Windows
(AD, DNS, DHCP, GPO, sauvegardes), routeurs, commutateurs, Wi-Fi, pare-feu, VPN
(MikroTik, Ubiquiti, TP-Link, Cisco, Fortinet, Aruba, Huawei), cartographie et
surveillance proactive, mode « IT autonome », et une vue de parc (« 42 PC OK, 5 à
intervenir, 2 critiques » ; « corrige tous les problèmes non critiques »).

**Ce n'est pas une extension de l'agent PC**, pour des raisons de sûreté et d'architecture :

- il faut des **connecteurs par constructeur** (API, SSH, WinRM), chacun avec une liste blanche d'opérations en lecture d'abord ;
- il faut stocker des **identifiants d'équipements** : chiffrés au repos (comme `SESSION_SECRETS_KEY`), jamais montrés à l'IA, jamais dans les journaux ;
- une **passerelle** installée sur le réseau du client (l'API cloud ne joint pas un routeur privé), avec exécution sortante seulement ;
- un **espace société** côté API (société, machines, rôles, droits par machine) et des agents rattachés ; la vue de parc et le traitement « machine par machine » en dépendent ;
- une **validation humaine** obligatoire pour tout changement réseau/pare-feu/VPN/domaine, un point de retour (sauvegarde de configuration avant) et un journal d'audit par équipement ;
- surveillance proactive = un service qui tourne en continu (alertes), donc une exploitation, pas un script.

Ordre proposé : (1) espace société + rattachement des PC + vue de parc en lecture seule (FAIT : codes de rattachement, santé du poste, synthèse ; voir `docs/agent.md`) ; (2) passerelle + découverte réseau en lecture seule (cartographie ; première tranche faite : compétence `lan-map`, vue depuis un seul PC, passive) ; (3) un premier connecteur en lecture seule (Windows Server via WinRM, ou MikroTik) ; (4) actions à validation humaine. En attendant, l'agent le dit franchement au client et propose un technicien (`router.ts`, intention `human_only`).
