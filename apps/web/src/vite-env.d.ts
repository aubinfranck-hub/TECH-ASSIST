/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Liens de téléchargement de l'application (absents tant que les installateurs ne sont pas publiés). */
  readonly VITE_APP_WINDOWS_URL?: string;
  readonly VITE_APP_ANDROID_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
