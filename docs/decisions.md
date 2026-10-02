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
| D9 | Modes d'assistance et abonnement particulier | **Tranché** (demande du porteur) | Agent IA par défaut + technicien humain ; 1re assistance offerte ; abonnement 10 000 FCFA/mois |

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
technicien humain reste une option.

| Règle | Valeur |
|---|---|
| Mode par défaut | Agent IA (`ia`) ; technicien humain (`humain`) au choix |
| Assistance offerte | 1 par numéro de téléphone, 30 min, 0 FCFA (`assistance_offerte`) |
| Ensuite | Abonnement 10 000 FCFA / 30 jours (`abonnement_mensuel`), assistances illimitées |
| Paiement | Mobile Money, confirmé à la main par un technicien (D3) ; l'abonnement s'active à la confirmation |
| Renouvellement avant échéance | Prolonge la période en cours (pas de perte de jours) |

**Garanties côté serveur** (`apps/api/src/routes/assistance.ts`) : la couverture
(offre / abonnement) est vérifiée par l'API, jamais choisie par le client ; les
formules à 0 FCFA ne sont pas commandables via `/api/orders` ; deux demandes
simultanées du même numéro ne donnent qu'une seule offre gratuite (verrou
consultatif PostgreSQL).

**Agent IA : pas encore branché.** Tant que `AI_AGENT_ENABLED` n'est pas à `true`,
une demande « IA » est servie par un technicien (la session garde
`requested_mode = 'ia'`, l'écran le dit au client). Quand l'agent existera, il
traitera les sessions `mode = 'ia'`, qui n'entrent pas dans la file des
techniciens ; le client peut toujours « Passer à un technicien »
(`POST /api/sessions/:id/escalate`).

**Limite connue** : le numéro de téléphone n'est pas vérifié. Quelqu'un peut
utiliser plusieurs numéros pour obtenir plusieurs assistances offertes. Piste :
vérification par code SMS (OTP) avant l'assistance offerte.
