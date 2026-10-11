#!/usr/bin/env bash
# Regroupe des bases PostgreSQL Render dans ntic-shared-db : une base logique
# par projet, dans la même instance (une seule instance payante au lieu de N).
# Runbook complet : docs/consolidation-bases-render.md
#
# Usage :
#   NTIC_ADMIN_URL=...  SRC_DIAGASSIST_URL=...  ./consolidate-into-ntic.sh --check diagassist
#   NTIC_ADMIN_URL=...  SRC_DIAGASSIST_URL=...  ./consolidate-into-ntic.sh diagassist skindiag ...
#
#   --check  vérifie tout (connexions, versions, tables) sans rien écrire.
#
# Variables (URL « External » de chaque base, copiées depuis le dashboard Render ;
# jamais écrites dans un fichier du dépôt) :
#   NTIC_ADMIN_URL      ntic-shared-db (base ntic_shared_db), utilisée pour CREATE DATABASE
#   SRC_<PROJET>_URL    base source du projet, ex. SRC_DIAGASSIST_URL
#
# Garanties : la source n'est jamais modifiée (pg_dump en lecture) ; une base
# cible qui contient déjà des tables n'est jamais écrasée ; une sauvegarde
# (.dump) reste dans $BACKUP_DIR ; les lignes de chaque table sont recomptées
# source vs cible avant de conclure.
#
# Le client pg_dump doit être >= à la version du serveur source (18 pour
# etravail-db et foncier360-db). Sinon, lancer le script dans l'image
# postgres:18 (voir le runbook).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./ntic-db-backups}"
MODE="migrate"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
  shift
fi

die() { echo "ERREUR : $*" >&2; exit 1; }
info() { echo "› $*"; }

[[ $# -ge 1 ]] || die "indique au moins un projet (ex. diagassist skindiag etravail foncier360 juriscoach)"
[[ -n "${NTIC_ADMIN_URL:-}" ]] || die "NTIC_ADMIN_URL manquante (URL External de ntic-shared-db)"
for bin in psql pg_dump pg_restore; do
  command -v "$bin" >/dev/null || die "$bin introuvable (installer le client PostgreSQL)"
done

# Même URL que NTIC_ADMIN_URL, avec un autre nom de base (la query string est conservée).
url_with_db() {
  local base="${NTIC_ADMIN_URL%%\?*}" query=""
  [[ "$NTIC_ADMIN_URL" == *\?* ]] && query="?${NTIC_ADMIN_URL#*\?}"
  echo "${base%/*}/$1$query"
}

major_of() {
  local num
  num=$(psql "$1" -Atqc "SHOW server_version_num" </dev/null) || return 1
  echo $(( num / 10000 ))
}

# « schema.table|nombre de lignes », une ligne par table utilisateur, triées.
table_counts() {
  local url="$1" t
  psql "$url" -Atqc "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables
                     WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1" </dev/null |
    while IFS= read -r t; do
      printf '%s|%s\n' "$t" "$(psql "$url" -Atqc "SELECT count(*) FROM $t" </dev/null)"
    done
}

info "Vérification de ntic-shared-db"
tgt_major=$(major_of "$NTIC_ADMIN_URL") || die "connexion à ntic-shared-db impossible"
can_create=$(psql "$NTIC_ADMIN_URL" -Atqc "SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user" </dev/null)
[[ "$can_create" == "t" ]] || die "l'utilisateur de ntic-shared-db ne peut pas créer de base"
client_major=$(pg_dump --version | grep -oE '[0-9]+' | head -1)

migrate_one() {
  local name="$1" var src src_major
  [[ "$name" =~ ^[a-z][a-z0-9_]*$ ]] || die "nom de projet invalide : '$name' (minuscules, chiffres, _)"
  var="SRC_$(echo "$name" | tr '[:lower:]' '[:upper:]')_URL"
  src="${!var:-}"
  [[ -n "$src" ]] || die "variable $var manquante"

  echo
  info "[$name] connexion à la source"
  src_major=$(major_of "$src") || die "[$name] connexion impossible (ton IP est-elle autorisée dans Networking → Inbound IP Rules de cette base ?)"
  (( client_major >= src_major )) || die "[$name] la source est en PostgreSQL $src_major, ton pg_dump est en $client_major : utilise l'image postgres:$src_major (voir le runbook)"
  (( src_major <= tgt_major )) || die "[$name] source en PostgreSQL $src_major, cible en $tgt_major : migration vers une version plus ancienne non supportée"

  local src_counts
  src_counts=$(table_counts "$src")
  info "[$name] source : $(echo "$src_counts" | grep -c . || true) tables, $(echo "$src_counts" | awk -F'|' '{s+=$2} END {print s+0}') lignes"
  echo "$src_counts" | sed 's/^/    /'

  if [[ "$MODE" == "check" ]]; then
    info "[$name] --check : rien n'est écrit"
    return
  fi

  local target_url exists n dump
  target_url=$(url_with_db "$name")
  exists=$(psql "$NTIC_ADMIN_URL" -Atqc "SELECT 1 FROM pg_database WHERE datname = '$name'" </dev/null)
  if [[ -z "$exists" ]]; then
    info "[$name] création de la base $name dans ntic-shared-db"
    psql "$NTIC_ADMIN_URL" -qc "CREATE DATABASE \"$name\"" </dev/null
  else
    n=$(psql "$target_url" -Atqc "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')" </dev/null)
    (( n == 0 )) || die "[$name] la base cible existe déjà avec $n tables : je n'écrase rien (la supprimer à la main si c'est voulu)"
  fi

  mkdir -p "$BACKUP_DIR"
  dump="$BACKUP_DIR/${name}-$(date -u +%Y%m%dT%H%M%SZ).dump"
  info "[$name] sauvegarde -> $dump"
  pg_dump --format=custom --no-owner --no-acl --file="$dump" "$src"

  info "[$name] restauration dans ntic-shared-db/$name"
  # COMMENT ON EXTENSION exige d'être propriétaire de l'extension : erreur bénigne, on l'écarte.
  pg_restore --list "$dump" | grep -v ' COMMENT - EXTENSION ' > "$dump.list"
  pg_restore --no-owner --no-acl --use-list="$dump.list" --dbname="$target_url" "$dump" \
    || die "[$name] la restauration a signalé des erreurs. Lis-les ci-dessus ; pour recommencer : DROP DATABASE \"$name\" puis relance (la source n'a pas été modifiée)"

  info "[$name] vérification : lignes par table, source vs cible"
  if [[ "$src_counts" == "$(table_counts "$target_url")" ]]; then
    info "[$name] OK : toutes les tables ont le même nombre de lignes"
  else
    echo "--- différences (source < > cible) ---" >&2
    diff <(echo "$src_counts") <(table_counts "$target_url") >&2 || true
    die "[$name] écarts de comptage (une écriture a-t-elle eu lieu pendant la copie ? relance après avoir mis l'app en pause)"
  fi
  info "[$name] terminé. Prochaine étape : dans le service, DATABASE_URL = URL Internal de ntic-shared-db avec le nom de base '$name'."
}

for project in "$@"; do
  migrate_one "$project"
done

echo
if [[ "$MODE" == "check" ]]; then
  info "Vérification terminée, rien n'a été écrit. Relance sans --check pour migrer."
else
  info "Terminé. Sauvegardes dans $BACKUP_DIR — à conserver tant que les anciennes bases ne sont pas supprimées."
fi
