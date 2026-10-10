/**
 * Alerte du technicien : un « ding-dong » quand un client demande de l'aide. Le son est fabriqué par le navigateur (aucun fichier) ;
 * les navigateurs n'autorisent l'audio qu'après un clic de l'utilisateur : le premier clic « active » le son.
 */

/** Les demandes apparues depuis la dernière lecture. Premier appel (`seen` nul) : rien n'est « nouveau », on mémorise seulement. */
export function newRequests(seen: ReadonlySet<string> | null, ids: readonly string[]): { fresh: string[]; seen: Set<string> } {
  const now = new Set(ids);
  if (!seen) return { fresh: [], seen: now };
  return { fresh: ids.filter((id) => !seen.has(id)), seen: now };
}

type AudioCtor = typeof AudioContext;

export function audioContext(): AudioContext | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  try {
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

/** « Ding » (aigu) puis « dong » (grave), deux fois. Renvoie false si le navigateur bloque encore l'audio. */
export async function ringDingDong(ctx: AudioContext): Promise<boolean> {
  try {
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    return false;
  }
  if (ctx.state !== 'running') return false;
  const start = ctx.currentTime + 0.05;
  const tones: [number, number][] = [[880, 0], [660, 0.45], [880, 1.1], [660, 1.55]];
  for (const [freq, offset] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.6, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start + offset);
    osc.stop(start + offset + 0.42);
  }
  return true;
}

/** Notification du système (barre des tâches / écran verrouillé du téléphone), si l'utilisateur l'a acceptée. */
export function notifyRequest(title: string, body: string): void {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, tag: 'tech-assist-demande', requireInteraction: true });
  } catch {
    /* sans notification, le son et le titre de l'onglet suffisent */
  }
}
