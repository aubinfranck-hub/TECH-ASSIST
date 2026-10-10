import type { HumanAccess } from './humanAccess.js';
import type { AgentEvent, Reporter } from './types.js';

/** Journal côté serveur : chaque étape de l'agent est enregistrée dans l'audit de la session. */
export class HttpReporter implements Reporter {
  constructor(
    private readonly apiBase: string,
    private readonly token: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    /** Un technicien fait-il partie de cette assistance ? Absent = oui. Le serveur a le dernier mot (il l'indique dans sa réponse). */
    readonly human?: HumanAccess,
  ) {}

  async event(event: AgentEvent): Promise<void> {
    const res = await this.fetchImpl(`${this.apiBase.replace(/\/$/, '')}/api/app/sessions/${this.sessionId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`le serveur a répondu ${res.status}`);
    if (event.type === 'escalated' && this.human) {
      const answer = (await res.json().catch(() => null)) as { humanIncluded?: unknown } | null;
      if (answer?.humanIncluded === false) this.human.included = false;
    }
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

  get human(): HumanAccess | undefined {
    return this.reporters.find((r) => r.human)?.human;
  }

  async event(event: AgentEvent): Promise<void> {
    const results = await Promise.allSettled(this.reporters.map((r) => r.event(event)));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
}
