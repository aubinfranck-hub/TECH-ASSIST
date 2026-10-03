# Décisions (D1 à D14)

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
| D14 | Offres : IA seule / IA + technicien, entreprises par postes | **Tranché** (demande du porteur) | 500 FCFA = agent IA seul ; 2 000 FCFA = agent IA + technicien ; entreprise = forfait selon le nombre de postes, IA et technicien toujours inclus : voir D14 plus bas |

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

Couverture société (FAIT) : un PC rattaché à une entreprise dont l’abonnement est `active` est couvert (`coverage: company`) sans offre ni abonnement personnel ; l’administrateur Tech Assist active l’abonnement société.

Ordre proposé : (1) espace société + rattachement des PC + vue de parc en lecture seule (FAIT : codes de rattachement, santé du poste, synthèse ; voir `docs/agent.md`) ; (2) passerelle + découverte réseau en lecture seule (cartographie ; première tranche faite : compétence `lan-map`, vue depuis un seul PC, passive) ; (3) un premier connecteur en lecture seule (Windows Server via WinRM, ou MikroTik) ; (4) actions à validation humaine. En attendant, l'agent le dit franchement au client et propose un technicien (`router.ts`, intention `human_only`).

## D10 — Forfaits à l'usage (particuliers) et contrat mensuel (entreprises) — remplacé par D14 pour les offres

Remplace l'abonnement particulier à 10 000 FCFA/mois (qui reste techniquement présent mais n'est plus mis en avant).

- **Particulier** : première assistance offerte (une par e-mail/appareil), puis un forfait **par assistance**, payé par Mobile Money et confirmé par un technicien : **Diagnostic 500** (portée `diagnostic` : l'agent analyse et explique, ne modifie rien), **Dépannage 2 000** (`fix` : un problème précis), **Intervention complète 5 000** (`full` : analyse et réparation complètes). La portée est lue de `pricing_plans.metadata.scope` ; elle est appliquée par l'agent (`converse` + `runSkill readOnly`).
- **Entreprise** : un contrat mensuel unique de 10 000 FCFA (couverture des postes rattachés). Les paliers PME historiques (9 900 / 24 900 / 49 900) restent dans la base en attendant l'arbitrage commercial.
- Parcours : `POST /app/orders` → paiement → confirmation par un technicien (`confirm-payment`) → `GET /app/orders/:id` (attente) → `POST /app/assistance {orderId}` ; une commande ne démarre qu'une session (index unique), un forfait payé non utilisé est retrouvé via `entitlements.paidForfait`.
- Transparence : l'agent est présenté pour ce qu'il est ; un technicien nommé supervise et le bouton « Parler à un humain » reste visible. Aucune formulation ne prétend qu'un humain écrit quand c'est l'IA.

## D14 — Offres : IA seule, IA + technicien, entreprises par postes

Demande du porteur : « 500 FCFA = l'IA seule ; 2 000 FCFA = l'IA et l'intervention d'un humain ; les entreprises paient selon le nombre de machines, IA et humain toujours inclus ».

| Offre | Prix | Contenu |
|---|---|---|
| **Assistance IA** (`diagnostic_express`) | 500 FCFA | L'agent IA analyse et répare avec l'accord du client à chaque action. **Aucun technicien** : aucune alerte, aucun passage de main. |
| **Assistance IA + technicien** (`assistance_rapide`) | 2 000 FCFA | L'agent d'abord ; un technicien prend le relais si le problème le demande. |
| **Complément technicien** (`complement_technicien`, interne) | 1 500 FCFA (**hypothèse**, modifiable en admin) | Un client « IA seule » qui a besoin d'un humain paie la différence **une fois, pour cette assistance** ; même paiement qu'un forfait. |
| **Entreprise** (`pme_essentiel` / `pme_pro` / `pme_entreprise`) | 9 900 / 24 900 / 49 900 FCFA par mois (**placeholders**, à arbitrer) | Forfait selon le nombre de postes (5 / 15 / 40) ; IA **et** technicien toujours inclus ; quotas et délais de réponse inchangés (D7). |

Règles appliquées **côté serveur** (jamais seulement dans l'interface) :
- `sessions.human_included` est copié du forfait à la création de la session (toujours vrai : assistance offerte, abonné, entreprise, ou `FREE_LAUNCH`) ;
- une session « IA seule » : `/sessions/:id/escalate` répond 402 `human_not_included` ; l'événement `escalated` de l'agent est **journalisé mais n'alerte personne** et ne passe pas la session en mode humain (réponse `humanIncluded:false` + proposition de complément) ;
- complément : `POST /app/sessions/:id/upgrade` crée une commande (`orders.upgrade_session_id`), payée par Jèko ou confirmation manuelle ; `markOrderPaid` bascule alors `human_included` ;
- entreprise : `maxDevices` est **appliqué** au rattachement (`/app/company/join` refuse au-delà, code `device_limit`).

Côté agent : `humanAccess.ts`. Avant tout passage de main (`runSkill`, `converse`, bouton « Parler à un technicien »), `ensureHuman` vérifie l'offre. Sans technicien : l'agent le dit honnêtement, propose le complément (paiement dans la conversation) et, si le client refuse, **continue seul** — il ne prétend jamais prévenir un technicien. Le bouton de la fenêtre ne ferme plus la conversation dans ce cas : la demande arrive à l'agent comme un message du client.

L'ancien forfait à 5 000 FCFA (`session_maintenance`) est retiré de l'offre (inactif) ; les anciennes portées `diagnostic` / `fix` restent comprises par l'agent pour les commandes déjà payées. Tant que `FREE_LAUNCH` est vrai, aucun paiement n'est exigé et un technicien est toujours inclus.

## D15 — Apprentissage : l'IA compose, la mémoire retient, l'agent exécute dans un catalogue fermé (FAIT)

Demande du porteur : quand l'agent ne trouve pas le service, il fait appel à l'IA pour l'implémenter automatiquement ; une fois implémenté, **demain l'IA n'est plus consultée pour ce cas**. Clés DeepSeek, Gemini et si possible Claude fournies par le porteur.

**Principe** : l'IA ne produit jamais de commande. Elle compose une **procédure** (JSON) avec les seules opérations d'un **catalogue fermé** (`apps/agent/src/procedures/manifest.ts`, copie identique côté API `apps/api/src/learning/manifest.ts`, test de conformité) :
- observer : état d'un service, processus, erreurs du journal, espace disque, ping, port, DNS, programme installé, réglage ;
- agir : démarrer/redémarrer un service, changer son démarrage, arrêter un processus, relancer l'Explorateur, vider ses caches, réinitialiser le réseau (DNS, IP, Winsock), démarrage rapide, proxy (désactivation seulement).
Une procédure = 6 vérifications, 6 corrections, 10 étapes, 5 conseils, 12 mots-clés au plus.

**Sûreté (deux validations indépendantes)** : le serveur valide ce que renvoie l'IA, **l'agent revalide tout** (`compileProcedure`) et ne fait confiance ni au serveur ni à l'IA. Listes de protection : services système (`PROTECTED_SERVICES`) jamais modifiés, services jamais activés (`NEVER_ENABLE_SERVICES`), processus protégés (shell, Explorateur, l'agent), jamais de démarrage « Désactivé », hôtes réseau limités (sites publics connus, IPv4 privées, noms du réseau local), ports limités. Les gestes sensibles ont un **point de restauration** ; ceux qui demandent les droits d'administrateur passent par le consentement unique habituel (droits temporaires, puis tout est remis en place) et sont mis de côté sans eux. Une procédure hors catalogue est refusée (« rejected_by_agent ») et n'est plus servie telle quelle. Les clés ne figurent jamais dans les erreurs ni les journaux.

**Mémoire (serveur, migration 015)** : `learned_procedures` (procédure, mots-clés, statut `candidate` | `trusted` | `retired`, `locked` quand un administrateur a tranché), `learned_procedure_runs` (procédure servie à une session → résultat), `knowledge_gaps` (cas non couverts, pour étendre le catalogue), `learning_calls` (coût, par IA et par modèle).
- **Retrouver sans IA** : mots utiles réduits à 5 lettres, sans accent, mots vides français ôtés ; une demande retrouve une procédure si elle partage au moins 2 clés **et** que 75 % de ses clés sont couvertes (mieux vaut rappeler l'IA que servir le cas d'un autre). Quand l'IA retombe sur une procédure connue, celle-ci retient la nouvelle formulation.
- **Confiance** : une procédure proposée par l'IA est `candidate` ; elle devient `trusted` après `LEARNING_PROMOTE_AFTER` postes **différents** où le client confirme « c'est réglé » (échecs < succès) ; elle est `retired` à partir de 2 échecs plus nombreux que les succès. Seule une procédure réellement servie à la session peut recevoir un résultat (une fois par session). Une ligne altérée en base n'est jamais servie (revalidation à la lecture) et est réparée quand l'IA recompose la même procédure.
- **Pistes à éviter** : les procédures écartées sont transmises à l'IA suivante comme « déjà essayées sans succès » ; si elle repropose la même, le cas est noté comme manque.
- **Coût maîtrisé** : plafonds `LEARNING_MAX_AI_PER_SESSION` (6), `…_PER_INSTALL_DAY` (15), `…_PER_DAY` (600) ; ordre d'essai `LEARNING_PROVIDERS` (défaut deepseek, gemini, claude), une IA qui répond hors règles est remplacée par la suivante avec la raison du refus.
- **Administration** (API, `/api/admin/knowledge`) : liste des procédures (avec succès/échecs), valider, écarter, cas non couverts (`/gaps`). Pas encore d'écran dans le site.

**Agent** (`conversation.ts`, `knowledge.ts`) : seulement si aucune compétence connue ne correspond (`routeIntent` d'abord, donc les cas connus n'appellent jamais la mémoire). L'agent dit au client d'où vient le plan (mémoire ou IA), exécute avec les mêmes tâches suivies, vérifications et accords que les autres compétences, puis remonte le résultat. Sans réseau, mémoire indisponible ou IA indisponible : repli sur le cheminement habituel (réparation autonome, puis technicien).

Non validé en conditions réelles : aucune clé d'IA n'est configurée à ce jour (le serveur sert la mémoire sans clé, mais ne génère rien) ; qualité des procédures réelles composées par les IA à observer sur de vrais PC ; seuils de correspondance et de promotion à ajuster avec l'usage. Prolongements : écran d'administration, cache local hors ligne, ajout au catalogue des capacités les plus demandées dans `knowledge_gaps`.

## D16 — Techniciens partenaires (viewer) et rémunération des techniciens à l'assistance (FAIT)

Demande du porteur : tout technicien indépendant peut utiliser Tech Assist comme viewer (à la place de TeamViewer ou AnyDesk) : **session gratuite de 3 minutes, puis 500 FCFA la session** ; et les techniciens garantis sont **payés à chaque assistance terminée**, selon l'assistance. Cette décision remplace l'abonnement mensuel par PC imaginé en D13 par une facturation à la session.

**Compte partenaire** (`routes/partner.ts`) : inscription publique (`POST /partner/register`) → compte fermé (`approval_status = pending`, inactif) tant qu'un administrateur ne l'a pas validé (écran Administration, `POST /admin/partners/:id/decision` : valider, refuser, suspendre, réactiver) ; l'équipe est prévenue par email (`TECH_ALERT_EMAILS`). Même table que les techniciens, rôle `partner` : **aucune route du personnel ni de l'administration ne l'accepte**, et le personnel n'entre pas dans l'espace partenaire. 2FA obligatoire avant d'ouvrir une session. Un compte suspendu perd l'accès immédiatement (le jeton ne suffit pas). La page de connexion indique « en cours de validation » seulement quand le mot de passe est bon.

**Session viewer** : le partenaire ouvre une session (code à 9 chiffres, 10 min), donne le code à SON client, qui l'ouvre sur la page « Ma session » (parcours existant : appairage RustDesk + consentement au contrôle, RS-01). Quand le client a autorisé, le partenaire se connecte (`/connect` remet les identifiants). La **durée gratuite démarre à la première remise des identifiants** (3 min, `VIEWER_FREE_SECONDS`). Passé ce délai sans paiement : plus d'identifiants, le prix est annoncé, et la session est **coupée** à l'issue d'un délai de grâce (`VIEWER_GRACE_SECONDS`, 60 s) — session terminée, mot de passe distant effacé (RS-10), commande annulée. Le paiement (500 FCFA, `POST …/pay`, Jèko) est possible à tout moment et débloque la session jusqu'à sa fin. Anti-abus : pas de seconde durée gratuite pour le même poste avec le même partenaire dans les 24 h, plafond de sessions gratuites par partenaire et par jour (`VIEWER_MAX_FREE_PER_DAY`), 3 sessions ouvertes au plus. Une session terminée dans la durée gratuite ne coûte rien. Techniquement : une ligne `sessions` de type `viewer` (réutilise appairage, consentement, journal d'audit) rattachée à une commande de la formule interne `viewer_session` (sans durée : refusée par toutes les routes de commande, absente des tarifs ; confirmée seulement par Jèko ou par un administrateur, jamais par le personnel). Aucune tâche planifiée : l'état se calcule à la lecture et la coupure s'exécute au premier appel qui constate le dépassement, qu'il vienne du partenaire ou de la fenêtre du client.

**Gains** (`partners/earnings.ts`, migration 016) : la fin d'une assistance avec un technicien du personnel (par le technicien, ou arrêt de la session) crédite **une** ligne de gain (unique par session, rejouable sans doublon). Le montant vient de la grille `technician_pay_rates` selon le type : IA + technicien, technicien ajouté à une assistance IA (complément), entreprise — **montants de départ à 1 000 FCFA, à fixer par l'administrateur** (modifiables sans redéploiement ; un nouveau montant ne vaut que pour l'avenir). Pas de gain pour une assistance « IA seule », pour un administrateur, ni pour une session partenaire. Le gain naît `pending` avec des éléments de contrôle (messages écrits, accès à distance consulté, durée, montant payé par le client, **commande confirmée à la main par ce même technicien** : signalé en rouge) ; l'administrateur le **valide** (`approved`), le corrige (raison obligatoire) ou l'écarte (raison obligatoire), puis enregistre un **versement** : tout ce qui est validé pour un technicien passe à `paid` dans une transaction (verrou, jamais deux fois), avec la référence du transfert Mobile Money. Le technicien voit son solde (en validation / à recevoir / versé), ses dernières assistances et enregistre son numéro de versement (Wave, Orange, MTN, Moov, Djamo). Tout est journalisé (`earning.*`, `partner.*`, `viewer.*`).

**Limites connues** : (1) la coupure d'une connexion RustDesk déjà ouverte n'est pas garantie par le serveur seul : il cesse de remettre les identifiants, efface le mot de passe distant et termine la session ; la coupure ferme dépend du serveur RustDesk (`infra/rustdesk/`, non déployé) ou d'une passerelle web, non construits ; (2) le versement est manuel (l'administrateur envoie l'argent et note la référence) : l'API de transfert Jèko n'est pas branchée ; (3) un paiement arrivé après la coupure marque la commande payée sans rouvrir la session (remboursement manuel) ; (4) pas encore de CGU partenaire ni de validation juridique ; (5) non testé avec un vrai paiement Jèko ni un vrai poste client.

## D11 — Paiement automatique (Jèko)

Prestataire : [Jèko](https://developer.jeko.africa) (Wave, Orange, MTN, Moov, Djamo). Parcours : le client choisit sa méthode, `POST /app/orders/:id/pay` crée la demande de paiement chez Jèko (`POST /partner_api/payment_requests`, `amountCents` = FCFA × 100, `reference` = id de la commande) et renvoie le `redirectUrl`. Jèko notifie `POST /api/payments/webhook` (événement `TRANSACTION_COMPLETED`, en-tête `Jeko-Signature` = HMAC-SHA256 hex du corps brut avec le secret webhook). Le serveur vérifie la signature, la boutique, le statut `success`, la référence et le montant (FCFA, ou centimes), marque la commande payée une seule fois (`markOrderPaid`, aussi utilisé par la confirmation manuelle) et répond 200 (Jèko désactive un webhook après 15 échecs consécutifs). L'agent et la page téléphone sondent la commande et démarrent l'assistance dès qu'elle est payée. Variables : `JEKO_API_KEY`, `JEKO_API_KEY_ID`, `JEKO_STORE_ID`, `PAYMENT_WEBHOOK_SECRET`, `PUBLIC_WEB_URL`. Sans elles, le parcours manuel (confirmation par un technicien) reste actif. Non validé avec un vrai paiement : le format exact du montant dans la notification est à confirmer par un premier paiement test (boutique dédiée, 500 FCFA). Webhook à enregistrer dans le Dashboard : `https://<api>/api/payments/webhook`.

## D12 — Passage de main à un technicien (FAIT)

Constat : l'agent disait « je passe la main à un technicien qui verra tout » mais il n'y avait pas de route : personne n'était prévenu, le technicien n'avait pas d'outil pour voir le dossier ni répondre.

Décision : (1) tout passage de main enregistré par le serveur **alerte automatiquement les techniciens de permanence** (notification du téléphone, email, webhook) ; (2) le technicien dispose d'une **console pensée pour le téléphone** (permanence, file, dossier avec journal de l'agent, discussion, prise en charge, fin) ; (3) le client **garde sa fenêtre ouverte** et converse avec lui. Aucun message n'annonce un technicien si le serveur n'a pas enregistré la demande. Voir `docs/agent.md` (« Passage de main à un technicien »). Notifications : Web Push (VAPID), sans application à installer ; iPhone = page ajoutée à l'écran d'accueil.

## D13 — Plateforme des techniciens partenaires (réalisée par D16, sans l'abonnement mensuel)

Demande du porteur : un technicien indépendant (« TS ») utilise Tech Assist pour assister **ses propres clients**, paie son abonnement **via Tech Assist** (ordre de grandeur : 500 FCFA par ordinateur et par mois) et accède au PC de son client **par la plateforme** plutôt qu'avec TeamViewer ou AnyDesk.

Ce que l'existant fournit déjà : comptes techniciens (+ 2FA), candidatures (`technician_applications`), codes de rattachement d'un poste (`joinCompany`), accès à distance RustDesk avec accord du client et journal (`remote*`), paiement Jèko.

Ce qui manque (ordre proposé) :
1. **Compte partenaire** : inscription, validation par l'administrateur, 2FA obligatoire, CGU partenaire (le partenaire est responsable de sa relation avec son client).
2. **Parc du partenaire** : ses clients rattachent leur PC avec un code du partenaire (comme le rattachement entreprise) ; chaque PC rattaché = une ligne d'abonnement.
3. **Abonnement par PC** : facturation mensuelle via Jèko (les demandes de paiement Jèko sont ponctuelles : prévoir un lien de renouvellement et un rappel). Prix à fixer.
4. **Accès à distance par Tech Assist** : nécessite l'infrastructure RustDesk (`infra/rustdesk/`, aujourd'hui non déployée) ; accord du client à chaque session ou accord permanent explicite, révocable, avec journal visible par le client. L'accès permanent (PC non surveillé) demande un service Windows persistant : modèle de consentement et de sûreté à concevoir à part de l'agent actuel (une session, un accord).
5. Tableau de bord du partenaire (PC, sessions, facturation) et commission éventuelle de Tech Assist.

Prérequis : test réel du paiement Jèko, déploiement RustDesk, validation juridique des CGU partenaire.

## D17 — Droits par offre appliqués côté serveur (FAIT)

Constat : les droits des offres (D14) n'étaient que des textes ; rien n'empêchait un forfait « IA seule » d'atteindre la file des techniciens, ni une session de durer au-delà de la durée achetée.

Décision :
- **500 FCFA (IA seule)** : `sessions.human_included = false` ; refus `402 human_not_included` (avec l'offre de complément à 1 500 FCFA) si le client demande un technicien ; la session n'entre jamais dans la file et ne peut pas être prise en charge (claim refusé). Si l'agent IA est désactivé, `503 ai_unavailable` : la commande n'est pas consommée.
- **2 000 FCFA (IA + technicien) et entreprises** : visibles dans la file ; à la prise en charge l'horloge démarre avec un minimum de 10 minutes (`HUMAN_MIN_MINUTES`).
- **Une seule horloge** (`started_at`/`ends_at`) ; fin automatique (`stopped_by = 'timeout'`, mot de passe distant effacé, gain technicien crédité) par balayage toutes les minutes et à chaque lecture/événement de session.
- **`FREE_LAUNCH=true`** : technicien disponible pour tous, aucune limite de durée, aucun balayage.
- Reste à faire : versement automatique Mobile Money des gains des techniciens (D16) via les transferts Jèko — documentation à lire avant toute implémentation ; aujourd'hui les paiements restent manuels (`technician_payouts`).
