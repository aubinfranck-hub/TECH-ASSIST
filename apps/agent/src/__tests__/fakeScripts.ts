import type { ResultsView } from '../results.js';
import type { Action, AgentEvent, CommandResult, CommandRunner, ConversationUi, Reporter } from '../types.js';

export const ok = (stdout = 'OK'): CommandResult => ({ stdout, stderr: '', exitCode: 0 });
export const fail = (stderr: string): CommandResult => ({ stdout: '', stderr, exitCode: 1 });

export interface Route {
  label: string;
  test: (script: string) => boolean;
  reply: (script: string, call: number) => CommandResult;
}

/** Faux Windows « à routes » : chaque script est reconnu par un test, et la réponse peut faire évoluer l'état. */
export class ScriptedRunner implements CommandRunner {
  readonly calls: { label: string; script: string }[] = [];
  private readonly counts = new Map<string, number>();

  constructor(private readonly routes: Route[]) {}

  get modifications() {
    return this.calls.filter((c) => !c.label.startsWith('collect'));
  }

  count(label: string) {
    return this.calls.filter((c) => c.label === label).length;
  }

  async runPowerShell(script: string): Promise<CommandResult> {
    const route = this.routes.find((r) => r.test(script));
    if (!route) {
      this.calls.push({ label: 'unknown', script });
      return fail('script inattendu');
    }
    this.calls.push({ label: route.label, script });
    const n = (this.counts.get(route.label) ?? 0) + 1;
    this.counts.set(route.label, n);
    return route.reply(script, n);
  }
}

export class Recorder implements Reporter {
  readonly events: AgentEvent[] = [];
  async event(event: AgentEvent): Promise<void> {
    this.events.push(event);
  }
  get types() {
    return this.events.map((e) => e.type);
  }
}

export interface ConvScript {
  /** Réponses successives aux questions libres ; null = fermer la conversation. À défaut : fermer. */
  asks?: (string | null)[];
  /** Réponses successives aux listes (index). À défaut : renoncer. */
  picks?: (number | null)[];
  /** Accord par identifiant d'action (oui par défaut). */
  approve?: Record<string, boolean>;
  /** Réponses successives à « est-ce réglé ? » (oui par défaut). */
  fixed?: boolean[];
}

export class ScriptedConversation implements ConversationUi {
  readonly infos: string[] = [];
  readonly prompts: string[] = [];
  readonly choices: { question: string; options: string[] }[] = [];
  readonly proposed: string[] = [];
  readonly questions: string[] = [];
  readonly resultCards: ResultsView[] = [];
  private a = 0;
  private p = 0;
  private f = 0;
  handedOff = false;

  constructor(private readonly script: ConvScript = {}) {}

  info(message: string) {
    this.infos.push(message);
  }
  results(view: ResultsView) {
    this.resultCards.push(view);
  }
  async confirmAction(action: Action) {
    this.proposed.push(action.id);
    return this.script.approve?.[action.id] ?? true;
  }
  async confirmFixed(question: string) {
    this.questions.push(question);
    return this.script.fixed?.[this.f++] ?? true;
  }
  async ask(prompt: string) {
    this.prompts.push(prompt);
    const answers = this.script.asks ?? [];
    return this.a < answers.length ? answers[this.a++]! : null;
  }
  async choose(question: string, options: string[]) {
    this.choices.push({ question, options });
    const picks = this.script.picks ?? [];
    return this.p < picks.length ? picks[this.p++]! : null;
  }
  wasHandedOff() {
    return this.handedOff;
  }
  get said() {
    return this.infos.join('\n');
  }
}
