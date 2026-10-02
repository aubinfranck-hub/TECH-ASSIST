import type { AgentEvent, Reporter } from './types.js';

/** Journal côté serveur : chaque étape de l'agent est enregistrée dans l'audit de la session. */
export class HttpReporter implements Reporter {
  constructor(
    private readonly apiBase: string,
    private readonly token: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async event(event: AgentEvent): Promise<void> {
    const res = await this.fetchImpl(`${this.apiBase.replace(/\/$/, '')}/api/app/sessions/${this.sessionId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`le serveur a répondu ${res.status}`);
  }
}

/** Trace locale lisible : le client peut voir ce que l'agent a fait. */
export class ConsoleReporter implements Reporter {
  async event(event: AgentEvent): Promise<void> {
    const where = event.action ? `${event.skill}/${event.action}` : event.skill;
    console.log(`[agent] ${event.type} (${where})${event.message ? ` — ${event.message}` : ''}`);
  }
}

export class CompositeReporter implements Reporter {
  constructor(private readonly reporters: Reporter[]) {}

  async event(event: AgentEvent): Promise<void> {
    const results = await Promise.allSettled(this.reporters.map((r) => r.event(event)));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
}
