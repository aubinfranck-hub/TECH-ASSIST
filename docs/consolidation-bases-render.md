# Regrouper les bases Render dans `ntic-shared-db`

Objectif : payer **une** instance PostgreSQL au lieu de six. Chaque projet garde
sa propre base (`CREATE DATABASE`) dans `ntic-shared-db` : seul le
`DATABASE_URL` du service change, pas son code. Le schéma `tech_assist` de
Tech Assist n'est pas touché.

| | Avant (octobre, estimé) | Après |
|---|---|---|
| Bases PostgreSQL | ≈ 60 $/mois (6 instances, 80 Go) | ≈ 10,50 $/mois (1 instance, 15 Go) |

Tarifs : 6 $/mois par instance + 0,30 $/Go de disque. Un disque Render ne peut
pas être réduit, d'où le regroupement dans l'instance existante.

## Les bases concernées

| Base source | PG | Service à basculer¹ | Base cible |
|---|---|---|---|
| `juriscoach-db` (**gratuite, expire le 11/10/2026 à 16:12 UTC**) | 16 | `juriscoach-production` | `juriscoach` |
| `diagassist-db` | 16 | `diagassist-production` (+ `diagassist-hpweb-gateway` si son `DATABASE_URL` pointe dessus) | `diagassist` |
| `skindiag-db` | 16 | `skindiag-production` | `skindiag` |
| `etravail-db` | 18 | `etravail-api` | `etravail` |
| `foncier360-db` | 18 | `foncier360-production` | `foncier360` |
| `E.travail` | 18 | aucun : **vide** (0 table) → à supprimer | — |

¹ Association déduite des noms : vérifier dans l'onglet *Environment* de chaque
service que le `DATABASE_URL` contient bien l'identifiant (`dpg-…`) de la base.

## Étapes

**0. Avant 16:12 UTC le 11/10 : `juriscoach-db`.** Une base gratuite expirée
devient inaccessible tant qu'elle n'est pas passée en plan payant (14 jours de
grâce, puis suppression). Migrer d'abord ce projet (étapes 1 à 3).

**1. Autoriser ton IP, temporairement.** Les bases sources n'acceptent que le
réseau interne de Render. Dashboard → la base → *Networking* → *Inbound IP
Rules* → ajouter ton IP publique en `/32` (voir `https://ifconfig.me`).
`ntic-shared-db` est déjà ouverte.

**2. Récupérer les URL.** Dashboard → la base → *Connect* → **External**
Database URL, pour `ntic-shared-db` et pour chaque source. Ne les colle ni dans
le dépôt ni dans une conversation.

**3. Lancer la migration** depuis la racine du dépôt (client PostgreSQL ≥ 18
requis pour les sources en 18 ; sinon voir la variante Docker) :

```bash
export NTIC_ADMIN_URL='postgres://…ntic-shared-db…'
export SRC_JURISCOACH_URL='…' SRC_DIAGASSIST_URL='…' SRC_SKINDIAG_URL='…' \
       SRC_ETRAVAIL_URL='…' SRC_FONCIER360_URL='…'

# 1) à blanc : connexions, versions, tables — n'écrit rien
infra/render/consolidate-into-ntic.sh --check juriscoach diagassist skindiag etravail foncier360
# 2) migration (sauvegarde .dump + recomptage des lignes table par table)
infra/render/consolidate-into-ntic.sh juriscoach diagassist skindiag etravail foncier360
```

Variante Docker (n'exige aucune installation, client en version 18) :

```bash
docker run --rm -it -v "$PWD":/work -w /work \
  -e NTIC_ADMIN_URL -e SRC_JURISCOACH_URL -e SRC_DIAGASSIST_URL \
  -e SRC_SKINDIAG_URL -e SRC_ETRAVAIL_URL -e SRC_FONCIER360_URL \
  postgres:18 bash infra/render/consolidate-into-ntic.sh juriscoach diagassist skindiag etravail foncier360
```

Le script s'arrête avec un message clair au moindre écart (connexion, version,
base cible déjà remplie, comptage différent). Il ne modifie jamais la source et
n'écrase jamais une base cible non vide. Les sauvegardes restent dans
`ntic-db-backups/` (ignoré par git).

**4. Basculer chaque service.** Dashboard → le service → *Environment* →
`DATABASE_URL` = l'URL **Internal** de `ntic-shared-db`, en remplaçant le nom de
base final (`ntic_shared_db`) par le nom de la base cible du tableau. Enregistrer
redéploie le service ; tester l'application ensuite. Retour arrière : remettre
l'ancienne URL tant que l'ancienne base existe.

**5. Nettoyer** (économies réelles, seulement après 24-48 h de fonctionnement
normal) :

- supprimer `E.travail` (vide, aucun risque) — peut se faire tout de suite ;
- supprimer les anciennes bases : *Settings* → *Delete Database* ;
- retirer les règles IP ajoutées à l'étape 1 ; conserver les `.dump` quelque part.

**6. Optionnel : `diagassist-production` Starter → Free** (*Settings* →
*Instance Type*), −7 $/mois. Contrepartie : mise en veille après 15 min sans
trafic, premier appel suivant lent (~30-60 s).

## Limites

- Les écritures faites dans une ancienne base entre la copie (étape 3) et la
  bascule (étape 4) ne sont pas reprises. Les bases sont quasi inactives
  (≤ 1 connexion par tranche de 6 h depuis le 1er octobre) ; en cas de doute,
  mettre l'application en pause entre les deux.
- `ntic-shared-db` (0.1 CPU / 256 Mo, 103 connexions) héberge alors tous les
  projets : si l'un d'eux grossit, monter le plan de cette seule instance.
- Script testé sur PostgreSQL 16 (sources avec séquences, clés étrangères, vue,
  JSON, extension `pgcrypto`, base vide, refus d'écraser). Non testé contre les
  bases Render réelles ni via Docker.
