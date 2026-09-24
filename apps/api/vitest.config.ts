import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 15000,
    hookTimeout: 20000,
    // Les tests d'intégration partagent une seule base PostgreSQL (truncateAll
    // entre chaque test) : les fichiers doivent s'exécuter séquentiellement,
    // sinon un fichier vide les tables pendant qu'un autre les utilise.
    fileParallelism: false,
  },
});
