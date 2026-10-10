/**
 * Synthèse vocale Google Cloud Text-to-Speech (voix neuronales Neural2). La clé vient UNIQUEMENT de l'environnement du serveur
 * (GOOGLE_TTS_API_KEY, sinon GEMINI_API_KEY si l'API Text-to-Speech est activée pour cette clé) : jamais d'un client ni des journaux.
 */

export class TtsError extends Error {
  constructor(
    message: string,
    /** forbidden : la clé existe mais l'API Cloud Text-to-Speech n'est pas activée (ou clé restreinte) — il n'y a rien d'autre à essayer. */
    readonly code: 'not_configured' | 'unavailable' | 'forbidden',
  ) {
    super(message);
    this.name = 'TtsError';
  }
}

type Env = Record<string, string | undefined>;

/** Voix la plus naturelle de Google (Chirp 3 HD) ; si elle n'est pas offerte pour cette clé, repli sur Neural2 (moins naturelle). */
export const TTS_DEFAULT_VOICE = 'fr-FR-Chirp3-HD-Aoede';
export const TTS_FALLBACK_VOICE = 'fr-FR-Neural2-A';
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

/** Les voix Chirp 3 HD n'acceptent pas le réglage de hauteur (« pitch ») : il fait refuser la demande. */
function audioConfigFor(voice: string) {
  return voice.includes('Chirp') ? { audioEncoding: 'MP3', speakingRate: 1.0 } : { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 };
}

async function callGoogle(text: string, voice: string, apiKey: string, options: SynthesizeOptions): Promise<string> {
  const languageCode = voice.split('-').slice(0, 2).join('-');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetchImpl ?? fetch)('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      // La clé voyage dans un en-tête, jamais dans l'adresse (les adresses finissent dans les journaux).
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({ input: { text }, voice: { languageCode, name: voice }, audioConfig: audioConfigFor(voice) }),
    });
    if (response.status === 403 || response.status === 401) throw new TtsError(`réponse ${response.status}`, 'forbidden');
    if (!response.ok) throw new TtsError(`réponse ${response.status}`, 'unavailable');
    const data = (await response.json()) as { audioContent?: unknown };
    if (typeof data.audioContent !== 'string' || data.audioContent.length < 20) throw new TtsError('audio vide', 'unavailable');
    return data.audioContent;
  } catch (err) {
    if (err instanceof TtsError) throw err;
    throw new TtsError(err instanceof Error && err.name === 'AbortError' ? 'délai dépassé' : 'service injoignable', 'unavailable');
  } finally {
    clearTimeout(timer);
  }
}

/** Renvoie l'audio MP3 en base64. Lève TtsError (message sans clé ni texte du client). */
export async function synthesize(rawText: string, options: SynthesizeOptions = {}): Promise<{ audioBase64: string; mime: 'audio/mpeg'; voice: string }> {
  const env = options.env ?? process.env;
  const apiKey = env.GOOGLE_TTS_API_KEY?.trim() || env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new TtsError('clé absente', 'not_configured');
  const text = speechText(rawText);
  if (!text) throw new TtsError('rien à lire', 'unavailable');
  const wanted = ttsVoice(env);
  const voices = wanted === TTS_FALLBACK_VOICE ? [wanted] : [wanted, TTS_FALLBACK_VOICE];
  let last: TtsError = new TtsError('aucune voix', 'unavailable');
  for (const voice of voices) {
    try {
      return { audioBase64: await callGoogle(text, voice, apiKey, options), mime: 'audio/mpeg', voice };
    } catch (err) {
      if (!(err instanceof TtsError)) throw err;
      last = err;
      if (err.code === 'forbidden') break; // clé refusée : une autre voix n'y changera rien
    }
  }
  throw last;
}

export interface TtsHealth {
  available: boolean;
  voice?: string;
  /** not_configured : aucune clé ; forbidden : API Cloud Text-to-Speech non activée pour la clé ; unavailable : panne passagère. */
  reason?: 'not_configured' | 'forbidden' | 'unavailable';
}

let healthCache: { at: number; value: TtsHealth } | null = null;

/** Essai réel (mis en cache 10 min) : on sait si la voix Google marche VRAIMENT, pas seulement si une clé existe. */
export async function ttsHealth(options: SynthesizeOptions = {}, now = Date.now()): Promise<TtsHealth> {
  if (!ttsConfigured(options.env)) return { available: false, reason: 'not_configured' };
  if (healthCache && now - healthCache.at < 10 * 60_000 && !options.fetchImpl) return healthCache.value;
  let value: TtsHealth;
  try {
    const out = await synthesize('Bonjour.', options);
    value = { available: true, voice: out.voice };
  } catch (err) {
    value = { available: false, reason: err instanceof TtsError && err.code !== 'not_configured' ? err.code : 'unavailable' };
  }
  if (!options.fetchImpl) healthCache = { at: now, value };
  return value;
}

export function resetTtsHealthCache(): void {
  healthCache = null;
}
