# Décisions (D1 à D8)

Suivi des arbitrages listés dans le cahier des charges. Toutes les valeurs
chiffrées sont en base (`pricing_plans`, RF-41) et modifiables sans
redéploiement depuis l'administration.

| # | Sujet | Statut | Choix retenu |
|---|---|---|---|
| D1 | Client Windows : maison ou base ouverte | **Tranché** | RustDesk auto-hébergé (voir `docs/lot-l2-remote.md`) |
| D2 | Tarifs particuliers | **Tranché** (cahier des charges) | 500 / 2 000 / 5 000 FCFA, sans niveau gratuit |
| D3 | Agrégateur Mobile Money | **Ouvert** | Confirmation manuelle par un technicien en attendant |
| D4 | Contrôle Android : guidage seul ou accessibilité dès le départ | **Ouvert** | À trancher au Lot L3 |
| D5 | Techniciens partenaires payés à la session | **Tranché** (cahier des charges) | Part de la plateforme et statut juridique restent à fixer |
| D6 | Nom de marque et domaine | **Tranché (par défaut)** | "Tech Assist" conservé (déjà utilisé partout dans le code et les documents) |
| D7 | Paliers d'abonnement PME | **Tranché (par défaut)** | Voir tableau ci-dessous |
| D8 | Visites sur place : forfaits ou devis | **Tranché (par défaut)** | Forfaits fixes par type d'intervention (voir tableau) |

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
