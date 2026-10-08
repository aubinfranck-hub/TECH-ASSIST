/**
 * Lecture à voix haute des réponses de l'agent : le texte part vers le serveur Tech Assist, qui renvoie l'audio de la voix
 * neuronale Google (aucune clé sur le PC du client). Sans voix disponible, la fenêtre retombe sur la voix du navigateur.
 */
export interface SpeechAudio {
  audio: string;
  mime: string;
}

export type Speaker = (text: string) => Promise<SpeechAudio | null>;

export function makeSpeaker(apiBase: string, token: string, fetchImpl: typeof fetch = fetch): Speaker {
  return async (text: string) => {
    try {
      const res = await fetchImpl(`${apiBase.replace(/\/$/, '')}/api/app/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: text.slice(0, 4000) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { audio?: unknown; mime?: unknown };
      return typeof body.audio === 'string' && body.mime === 'audio/mpeg' ? { audio: body.audio, mime: 'audio/mpeg' } : null;
    } catch {
      return null;
    }
  };
}
