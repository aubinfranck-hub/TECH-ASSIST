/**
 * Fournisseurs d'IA du moteur d'apprentissage : DeepSeek, Gemini, Claude. Les clés viennent UNIQUEMENT de l'environnement
 * du serveur (jamais du code, jamais d'un client, jamais des journaux). L'ordre d'essai est `LEARNING_PROVIDERS`
 * (défaut : deepseek,gemini,claude — du moins cher au plus capable) ; un fournisseur sans clé est simplement ignoré.
 *
 * Un fournisseur renvoie du TEXTE (censé être du JSON) : rien de ce qu'il dit n'est exécuté ici. La réponse est validée
 * par le catalogue fermé (manifest.ts) dans orchestrator.ts, puis revalidée par l'agent.
 */

export type ProviderName = 'deepseek' | 'gemini' | 'claude';
export const PROVIDER_NAMES: readonly ProviderName[] = ['deepseek', 'gemini', 'claude'];

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: ProviderName,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderRequest {
  system: string;
  user: string;
  timeoutMs?: number;
}

export interface ProviderReply {
  text: string;
  provider: ProviderName;
  model: string;
}

type Env = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 2000;
const MAX_REPLY_CHARS = 20_000;

const keyEnv: Record<ProviderName, string> = { deepseek: 'DEEPSEEK_API_KEY', gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY' };

/** Nom de modèle sobre : il entre dans une adresse ou un corps de requête, jamais une valeur libre. */
function safeModel(value: string | undefined, fallback: string): string {
  const wanted = value?.trim();
  return wanted && /^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(wanted) ? wanted : fallback;
}

export function modelFor(provider: ProviderName, env: Env = process.env): string {
  if (provider === 'deepseek') return safeModel(env.DEEPSEEK_MODEL, 'deepseek-chat');
  if (provider === 'gemini') return safeModel(env.LEARNING_GEMINI_MODEL ?? env.GEMINI_MODEL, 'gemini-2.0-flash');
  return safeModel(env.ANTHROPIC_MODEL, 'claude-sonnet-5-5');
}

export function providerConfigured(provider: ProviderName, env: Env = process.env): boolean {
  return !!env[keyEnv[provider]]?.trim();
}

/** Fournisseurs à essayer, dans l'ordre, parmi ceux qui ont une clé. */
export function providerChain(env: Env = process.env): ProviderName[] {
  const wanted = (env.LEARNING_PROVIDERS ?? 'deepseek,gemini,claude')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderName => (PROVIDER_NAMES as readonly string[]).includes(s));
  return [...new Set(wanted)].filter((p) => providerConfigured(p, env));
}

export interface CallOptions {
  env?: Env;
  fetchImpl?: typeof fetch;
}

/** Appelle un fournisseur. Lève ProviderError (message sans clé ni contenu de la demande) en cas d'échec. */
export async function callProvider(provider: ProviderName, req: ProviderRequest, options: CallOptions = {}): Promise<ProviderReply> {
  const env = options.env ?? process.env;
  const apiKey = env[keyEnv[provider]]?.trim();
  if (!apiKey) throw new ProviderError('clé absente', provider);
  const doFetch = options.fetchImpl ?? fetch;
  const model = modelFor(provider, env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let response: Response;
    if (provider === 'deepseek') {
      const base = (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '');
      response = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
      });
    } else if (provider === 'gemini') {
      response = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        // La clé voyage dans un en-tête, jamais dans l'adresse (les adresses finissent dans les journaux).
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' },
        }),
      });
    } else {
      response = await doFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      });
    }
    if (!response.ok) throw new ProviderError(`réponse ${response.status}`, provider);

    const data = (await response.json()) as Record<string, unknown>;
    const text = extractText(provider, data);
    if (!text) throw new ProviderError('réponse vide ou bloquée', provider);
    return { text: text.slice(0, MAX_REPLY_CHARS), provider, model };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(err instanceof Error && err.name === 'AbortError' ? 'délai dépassé' : 'fournisseur injoignable', provider);
  } finally {
    clearTimeout(timer);
  }
}

function extractText(provider: ProviderName, data: Record<string, unknown>): string {
  if (provider === 'deepseek') {
    const choices = data.choices as { message?: { content?: unknown } }[] | undefined;
    const content = choices?.[0]?.message?.content;
    return typeof content === 'string' ? content.trim() : '';
  }
  if (provider === 'gemini') {
    const candidates = data.candidates as { content?: { parts?: { text?: unknown }[] } }[] | undefined;
    return (candidates?.[0]?.content?.parts ?? [])
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
  }
  const content = data.content as { type?: string; text?: unknown }[] | undefined;
  return (content ?? [])
    .map((c) => (c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('')
    .trim();
}
