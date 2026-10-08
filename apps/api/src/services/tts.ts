/**
 * Synthèse vocale Google Cloud Text-to-Speech (voix neuronales Neural2). La clé vient UNIQUEMENT de l'environnement du serveur
 * (GOOGLE_TTS_API_KEY, sinon GEMINI_API_KEY si l'API Text-to-Speech est activée pour cette clé) : jamais d'un client ni des journaux.
 */

export class TtsError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'unavailable',
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

type Env = Record<string, string | undefined>;

export const TTS_DEFAULT_VOICE = 'fr-FR-Neural2-A';
export const TTS_MAX_CHARS = 900;

export function ttsConfigured(env: Env = process.env): boolean {
  return !!(env.GOOGLE_TTS_API_KEY?.trim() || env.GEMINI_API_KEY?.trim());
}

/** Nom de voix sobre (ex. fr-FR-Neural2-B) : il entre dans le corps d'une requête, jamais une valeur libre. */
export function ttsVoice(env: Env = process.env): string {
  const wanted = env.GOOGLE_TTS_VOICE?.trim();
  return wanted && /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]{3,40}$/.test(wanted) ? wanted : TTS_DEFAULT_VOICE;
}

/** Texte à lire : sans mise en forme, émojis, adresses ni symboles que la voix épellerait ; coupé à une fin de phrase. */
export function speechText(raw: string, max = TTS_MAX_CHARS): string {
  const text = raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[`*_#>~|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut).trim();
}

export interface SynthesizeOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Renvoie l'audio MP3 en base64. Lève TtsError (message sans clé ni texte du client). */
export async function synthesize(rawText: string, options: SynthesizeOptions = {}): Promise<{ audioBase64: string; mime: 'audio/mpeg'; voice: string }> {
  const env = options.env ?? process.env;
  const apiKey = env.GOOGLE_TTS_API_KEY?.trim() || env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new TtsError('clé absente', 'not_configured');
  const text = speechText(rawText);
  if (!text) throw new TtsError('rien à lire', 'unavailable');
  const voice = ttsVoice(env);
  const languageCode = voice.split('-').slice(0, 2).join('-');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetchImpl ?? fetch)('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      // La clé voyage dans un en-tête, jamais dans l'adresse (les adresses finissent dans les journaux).
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voice },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 },
      }),
    });
    if (!response.ok) throw new TtsError(`réponse ${response.status}`, 'unavailable');
    const data = (await response.json()) as { audioContent?: unknown };
    if (typeof data.audioContent !== 'string' || data.audioContent.length < 20) throw new TtsError('audio vide', 'unavailable');
    return { audioBase64: data.audioContent, mime: 'audio/mpeg', voice };
  } catch (err) {
    if (err instanceof TtsError) throw err;
    throw new TtsError(err instanceof Error && err.name === 'AbortError' ? 'délai dépassé' : 'service injoignable', 'unavailable');
  } finally {
    clearTimeout(timer);
  }
}
