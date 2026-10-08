/** Un tour de conversation, transmis à l'assistant pour qu'il garde le fil. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Capture d'écran jointe par le client (déjà réduite par la page de conversation). */
export interface Attachment {
  mime: 'image/png' | 'image/jpeg';
  /** Base64 sans préfixe. */
  data: string;
}

/** Plafond partagé avec le serveur (800 000 caractères en base64). */
export const MAX_ATTACHMENT_CHARS = 800_000;

export type TrainingStepId = 'cours' | 'exercice' | 'correction' | 'bilan';

/** Demande de formation : identifiants d'un catalogue fermé, le texte des consignes est côté serveur. */
export interface LessonRequest {
  track: string;
  level: 1 | 2 | 3 | 4;
  step: TrainingStepId;
  index: number;
}

export interface AnswerOptions {
  lesson?: LessonRequest;
  image?: Attachment;
}

export type AssistantReply = { available: true; text: string } | { available: false };

/**
 * Assistant en ligne pour les questions d'usage (Office, Outlook, Windows…).
 * Il répond avec du TEXTE : l'agent n'exécute jamais rien qui vienne de lui. Les actions sur
 * l'appareil passent uniquement par les compétences à liste blanche.
 */
export interface Assistant {
  answer(message: string, history: ChatTurn[], options?: AnswerOptions): Promise<AssistantReply>;
  /** « Cette réponse vous aide-t-elle ? » : si oui, le serveur la retient dans le lexique (à relire par un technicien). */
  feedback?(helped: boolean): Promise<void>;
}

/** Assistant fourni par l'API Tech Assist (route de chat de la session). */
export class HttpAssistant implements Assistant {
  constructor(
    private readonly apiBase: string,
    private readonly token: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async answer(message: string, history: ChatTurn[], options: AnswerOptions = {}): Promise<AssistantReply> {
    try {
      const res = await this.fetchImpl(`${this.apiBase.replace(/\/$/, '')}/api/app/sessions/${this.sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          message: message.slice(0, 1000),
          history: history.slice(-8),
          ...(options.lesson ? { lesson: options.lesson } : {}),
          ...(options.image && options.image.data.length <= MAX_ATTACHMENT_CHARS ? { image: options.image } : {}),
        }),
      });
      if (!res.ok) return { available: false };
      const body = (await res.json()) as { answer?: unknown };
      return typeof body.answer === 'string' && body.answer.trim() ? { available: true, text: body.answer.trim() } : { available: false };
    } catch {
      return { available: false };
    }
  }

  async feedback(helped: boolean): Promise<void> {
    try {
      await this.fetchImpl(`${this.apiBase.replace(/\/$/, '')}/api/app/sessions/${this.sessionId}/chat/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ helped }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      // Aide à l'apprentissage : sans effet sur le dépannage si elle ne part pas.
    }
  }
}
