/** Un tour de conversation, transmis à l'assistant pour qu'il garde le fil. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export type AssistantReply = { available: true; text: string } | { available: false };

/**
 * Assistant en ligne pour les questions d'usage (Office, Outlook, Windows…).
 * Il répond avec du TEXTE : l'agent n'exécute jamais rien qui vienne de lui. Les actions sur
 * l'appareil passent uniquement par les compétences à liste blanche.
 */
export interface Assistant {
  answer(message: string, history: ChatTurn[]): Promise<AssistantReply>;
}

/** Assistant fourni par l'API Tech Assist (route de chat de la session). */
export class HttpAssistant implements Assistant {
  constructor(
    private readonly apiBase: string,
    private readonly token: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async answer(message: string, history: ChatTurn[]): Promise<AssistantReply> {
    try {
      const res = await this.fetchImpl(`${this.apiBase.replace(/\/$/, '')}/api/app/sessions/${this.sessionId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ message: message.slice(0, 1000), history: history.slice(-8) }),
      });
      if (!res.ok) return { available: false };
      const body = (await res.json()) as { answer?: unknown };
      return typeof body.answer === 'string' && body.answer.trim() ? { available: true, text: body.answer.trim() } : { available: false };
    } catch {
      return { available: false };
    }
  }
}
