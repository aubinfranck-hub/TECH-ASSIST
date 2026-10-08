/**
 * Application Android technicien : la console tourne dans une WebView qui expose « TechAssistApp ». La page lui confie le jeton d'appareil
 * (pour que le service d'alerte reste connecté application fermée) et lui laisse le son et les notifications.
 */
interface Bridge {
  setToken?: (token: string) => void;
  clear?: () => void;
}

export const nativeBridge = (): Bridge | undefined => (typeof window === 'undefined' ? undefined : (window as unknown as { TechAssistApp?: Bridge }).TechAssistApp);

export function syncNativeToken(token: string | null): void {
  const bridge = nativeBridge();
  if (!bridge) return;
  try {
    if (token) bridge.setToken?.(token);
    else bridge.clear?.();
  } catch {
    /* l'application native n'est pas joignable : sans effet sur la console */
  }
}
