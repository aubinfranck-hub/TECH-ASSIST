/**
 * Applications technicien (Windows, Android) : elles ouvrent la console avec le jeton de l'appareil dans l'adresse (#token=…, jamais dans la
 * requête : un fragment n'est ni envoyé au serveur ni journalisé) et en « mode application » (?app=1 : sans l'en-tête ni le pied du site).
 */
const TOKEN_KEY = 'tech_assist_token';
const APP_KEY = 'tech_assist_app';

interface Loc {
  hash: string;
  search: string;
  pathname: string;
}
interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Récupère « #token=… » : enregistre le jeton et renvoie la nouvelle adresse (sans le jeton), ou null s'il n'y en a pas. */
export function consumeTokenFromHash(loc: Loc, storage: Store): string | null {
  const params = new URLSearchParams(loc.hash.replace(/^#/, ''));
  const token = params.get('token');
  if (!token || !/^[A-Za-z0-9._-]{20,2000}$/.test(token)) return null;
  storage.setItem(TOKEN_KEY, token);
  params.delete('token');
  const rest = params.toString();
  return `${loc.pathname}${loc.search}${rest ? `#${rest}` : ''}`;
}

/** Mode application : demandé par ?app=1, puis retenu pour toute la session de la fenêtre. */
export function isAppMode(loc: Loc, session: Store): boolean {
  if (new URLSearchParams(loc.search).get('app')) {
    try {
      session.setItem(APP_KEY, '1');
    } catch {
      /* sans stockage, le paramètre suffit tant qu'il reste dans l'adresse */
    }
    return true;
  }
  try {
    return session.getItem(APP_KEY) === '1';
  } catch {
    return false;
  }
}
