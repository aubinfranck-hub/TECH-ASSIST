/**
 * Déploiement sur une base partagée entre plusieurs projets : DATABASE_URL
 * peut fixer le schéma cible via `?options=-csearch_path%3D<schema>`. Utilisé
 * par le script de migration pour créer ce schéma s'il n'existe pas encore
 * (une seule source de vérité — pas de variable séparée à tenir synchronisée).
 */
export function extractSearchPathSchema(databaseUrl: string): string | null {
  const optionsValue = new URL(databaseUrl).searchParams.get('options');
  const schemaMatch = optionsValue?.match(/-c\s*search_path=([a-zA-Z_][a-zA-Z0-9_]*)/);
  return schemaMatch?.[1] ?? null;
}
