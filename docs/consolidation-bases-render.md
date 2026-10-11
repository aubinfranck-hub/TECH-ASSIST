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

| Base source (identifiant dans l'URL) | PG | Service à basculer¹ | Base cible |
|---|---|---|---|
| [`juriscoach-db`](https://dashboard.render.com/d/dpg-dai2gumq1p3s73aqfca0-a) `dpg-dai2gumq1p3s73aqfca0-a` (**gratuite, expire le 11/10/2026 à 16:12 UTC**) | 16 | [`juriscoach-production`](https://dashboard.render.com/web/srv-dag5culbedkc73fkifc0) | `juriscoach` |
| [`diagassist-db`](https://dashboard.render.com/d/dpg-dacrg2e1egvs73f3hdjg-a) `dpg-dacrg2e1egvs73f3hdjg-a` | 16 | [`diagassist-production`](https://dashboard.render.com/web/srv-dacmsrh5efls73f0hg20) ; voir aussi [`diagassist-hpweb-gateway`](https://dashboard.render.com/web/srv-dasn0m3bc2fs73fvufd0) | `diagassist` |
| [`skindiag-db`](https://dashboard.render.com/d/dpg-dag9jb6q1p3s73c77gn0-a) `dpg-dag9jb6q1p3s73c77gn0-a` | 16 | [`skindiag-production`](https://dashboard.render.com/web/srv-dag5shijnfac73bq4ud0) | `skindiag` |
| [`etravail-db`](https://dashboard.render.com/d/dpg-daptqa2jnfac73e07670-a) `dpg-daptqa2jnfac73e07670-a` | 18 | [`etravail-api`](https://dashboard.render.com/web/srv-daptqe2d0e5s73add4a0) | `etravail` |
| [`foncier360-db`](https://dashboard.render.com/d/dpg-db12ml2d0e5s73dqnbd0-a) `dpg-db12ml2d0e5s73dqnbd0-a` | 18 | [`foncier360-production`](https://dashboard.render.com/web/srv-db12mf8u01pc73ci5ihg) | `foncier360` |
| [`E.travail`](https://dashboard.render.com/d/dpg-dapur3rncjis73fpumtg-a) `dpg-dapur3rncjis73fpumtg-a` | 18 | aucun : **vide** (0 table) → à supprimer | — |
| [`ntic-shared-db`](https://dashboard.render.com/d/dpg-dag1uq67bikc73e1gisg-a) `dpg-dag1uq67bikc73e1gisg-a` | 18 | **cible** de toutes les migrations | — |

¹ Association déduite des noms, non vérifiée : ouvrir l'onglet *Environment* du
service, regarder le `DATABASE_URL` ; l'identifiant `dpg-…` situé après le `@`
dit sur quelle base il pointe. Si le service utilise un autre nom de variable
(ex. `DB_URL`), c'est celle-là qu'il faut changer.

## Étapes

**0. Avant 16:12 UTC le 11/10 : `juriscoach-db`.** Une base gratuite expirée
devient inaccessible tant qu'elle n'est pas passée en plan payant (14 jours de
grâce, puis suppression). Migrer d'abord ce projet (étapes 1 à 3).

**1. Autoriser ton IP, temporairement.** Les bases sources n'acceptent que le
réseau interne de Render. Dashboard → la base → *Networking* → *Inbound IP
Rules* → ajouter ton IP publique en `/32` (voir `https://ifconfig.me`).
`ntic-shared-db` est déjà ouverte.

**2. Récupérer les URL et les mettre dans un fichier local.** Dashboard → la
base → *Connect* → **External** Database URL, pour `ntic-shared-db` et pour
chaque source. À la racine du dépôt, créer le fichier `ntic-migration.env`
(ignoré par git, ne jamais le commiter ni coller son contenu dans une
conversation) : une ligne `NOM=valeur` par URL, **sans guillemets** :

```
NTIC_ADMIN_URL=postgresql://ntic_shared_db_user:…@dpg-dag1uq67bikc73e1gisg-a.frankfurt-postgres.render.com/ntic_shared_db
SRC_JURISCOACH_URL=postgresql://juriscoach_db_user:…@dpg-dai2gumq1p3s73aqfca0-a.frankfurt-postgres.render.com/juriscoach_db
SRC_DIAGASSIST_URL=postgresql://diagassist_db_user:…@dpg-dacrg2e1egvs73f3hdjg-a.frankfurt-postgres.render.com/diagassist_db
SRC_SKINDIAG_URL=postgresql://skindiag_db_user:…@dpg-dag9jb6q1p3s73c77gn0-a.frankfurt-postgres.render.com/skindiag_db
SRC_ETRAVAIL_URL=postgresql://etravail_db_user:…@dpg-daptqa2jnfac73e07670-a.frankfurt-postgres.render.com/etravail_db
SRC_FONCIER360_URL=postgresql://foncier360_db_user:…@dpg-db12ml2d0e5s73dqnbd0-a.frankfurt-postgres.render.com/foncier360_db
```

(Les noms d'hôte ci-dessus suivent le format Render habituel : copier l'URL
exacte du dashboard plutôt que de la reconstruire.)

**3. Lancer la migration avec Docker** (rien d'autre à installer ; l'image
`postgres:18` fournit un client compatible avec toutes les sources). Depuis la
racine du dépôt, **un projet à la fois pour commencer**, d'abord à blanc :

PowerShell (Windows) :

```powershell
docker run --rm --env-file ntic-migration.env -v "${PWD}:/work" -w /work postgres:18 bash infra/render/consolidate-into-ntic.sh --check juriscoach
docker run --rm --env-file ntic-migration.env -v "${PWD}:/work" -w /work postgres:18 bash infra/render/consolidate-into-ntic.sh juriscoach
```

bash (macOS, Linux, WSL, Git Bash) : identique, avec `-v "$PWD":/work` à la place de `-v "${PWD}:/work"`.

Puis, une fois `juriscoach` terminé, les quatre autres en une commande
(`--check` d'abord, puis sans) :

```powershell
docker run --rm --env-file ntic-migration.env -v "${PWD}:/work" -w /work postgres:18 bash infra/render/consolidate-into-ntic.sh --check diagassist skindiag etravail foncier360
docker run --rm --env-file ntic-migration.env -v "${PWD}:/work" -w /work postgres:18 bash infra/render/consolidate-into-ntic.sh diagassist skindiag etravail foncier360
```

Succès = chaque projet affiche `OK : toutes les tables ont le même nombre de
lignes`, puis `Terminé`. Toute ligne `ERREUR` = rien n'est à basculer pour ce
projet ; la source n'a pas été modifiée. Si le dépôt a été cloné sous Windows **avant** le commit qui ajoute
`.gitattributes`, le script peut avoir des fins de ligne CRLF et échouer dans le
conteneur (`$'\r': command not found`) : le plus simple est de
recloner le dépôt une fois ce commit présent sur la branche.

Sans Docker : le script tourne aussi directement dans un terminal bash avec un
client `psql`/`pg_dump` en version ≥ 18 (≥ 16 suffit pour `juriscoach`,
`diagassist`, `skindiag`), avec les mêmes variables en `export`.

Le script s'arrête avec un message clair au moindre écart (connexion, version,
base cible déjà remplie, comptage différent). Il ne modifie jamais la source et
n'écrase jamais une base cible non vide. Les sauvegardes `.dump` restent dans
`ntic-db-backups/` (ignoré par git).

**4. Basculer chaque service.** Dashboard → le service → *Environment* →
`DATABASE_URL` = l'URL **Internal** de `ntic-shared-db` (*Connect* → *Internal*),
en remplaçant **uniquement** le nom de base à la fin :

```
postgresql://ntic_shared_db_user:MOT_DE_PASSE@dpg-dag1uq67bikc73e1gisg-a/ntic_shared_db
                                                                        └─ remplacer par juriscoach, diagassist, skindiag, etravail ou foncier360
```

Enregistrer redéploie le service ; tester l'application ensuite (ouvrir le site,
se connecter, vérifier une donnée connue). Retour arrière : remettre l'ancienne
URL tant que l'ancienne base existe.

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
