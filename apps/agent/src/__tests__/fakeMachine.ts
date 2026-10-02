import type { Action, AgentEvent, CommandResult, CommandRunner, Reporter, Ui } from '../types.js';

export interface MachineState {
  services: { name: string; status: string }[];
  endpoints: { flow: 'Render' | 'Capture'; guid: string; state: number; name: string }[];
  volume: number | null;
  muted: boolean | null;
  admin: boolean | null;
}

export const SPEAKER_GUID = '{3a1c52f4-0b7e-4e1d-9b5e-6f2d8c1a7e90}';
export const HEADSET_GUID = '{8d2e41b7-5c3a-4f60-a1d9-0e7b6c3f2a15}';

export function healthyState(): MachineState {
  return {
    services: [
      { name: 'Audiosrv', status: 'Running' },
      { name: 'AudioEndpointBuilder', status: 'Running' },
    ],
    endpoints: [{ flow: 'Render', guid: SPEAKER_GUID, state: 1, name: 'Haut-parleurs (Realtek)' }],
    volume: 0.67,
    muted: false,
    admin: true,
  };
}

export interface MachineOptions {
  /** L'action est acceptée mais n'a aucun effet (pour tester « problème persistant »). */
  noEffect?: boolean;
  failStartServices?: boolean;
  failEnable?: boolean;
  /** Le runner lui-même plante (délai dépassé, powershell.exe introuvable…). */
  crashOnAction?: boolean;
  failCollect?: boolean;
}

/**
 * Faux Windows : répond au script de collecte avec l'état courant, et applique
 * les modifications demandées par les scripts d'action de la compétence.
 */
export class FakeMachine implements CommandRunner {
  readonly calls: { kind: 'collect' | 'start_services' | 'enable' | 'unmute' | 'volume' | 'unknown'; script: string }[] = [];

  constructor(
    public state: MachineState,
    private readonly options: MachineOptions = {},
  ) {}

  get modifications() {
    return this.calls.filter((c) => c.kind !== 'collect');
  }

  async runPowerShell(script: string): Promise<CommandResult> {
    const ok = (stdout = 'OK'): CommandResult => ({ stdout, stderr: '', exitCode: 0 });
    const fail = (stderr: string): CommandResult => ({ stdout: '', stderr, exitCode: 1 });

    if (script.includes('MMDevices')) {
      this.calls.push({ kind: 'collect', script });
      if (this.options.failCollect) return fail('Accès refusé');
      return ok(JSON.stringify(this.state));
    }

    const modifying = (kind: 'start_services' | 'enable' | 'unmute' | 'volume') => {
      this.calls.push({ kind, script });
      if (this.options.crashOnAction) throw new Error('PowerShell : délai dépassé (45000 ms)');
    };

    if (script.includes('Start-Service')) {
      modifying('start_services');
      if (this.options.failStartServices) return fail("Impossible de démarrer le service (accès refusé)");
      if (!this.options.noEffect) this.state.services.forEach((s) => (s.status = 'Running'));
      return ok();
    }
    if (script.includes('[TaPolicy]::SetVisible')) {
      modifying('enable');
      if (this.options.failEnable) return fail('Windows a refusé la réactivation (code 0x80070005)');
      const match = /\{0\.0\.0\.00000000\}\.(\{[^}]+\})/.exec(script);
      const endpoint = this.state.endpoints.find((e) => e.guid === match?.[1]);
      if (!endpoint) return fail('Périphérique introuvable');
      if (!this.options.noEffect) endpoint.state = 1;
      return ok();
    }
    if (script.includes('[TaAudio]::Mute = $false')) {
      modifying('unmute');
      if (!this.options.noEffect) this.state.muted = false;
      return ok();
    }
    const volume = /\[TaAudio\]::Volume = ([0-9.]+)/.exec(script);
    if (volume) {
      modifying('volume');
      if (!this.options.noEffect) this.state.volume = Number(volume[1]);
      return ok();
    }
    this.calls.push({ kind: 'unknown', script });
    return fail('script inattendu');
  }
}

export class RecordingReporter implements Reporter {
  readonly events: AgentEvent[] = [];
  async event(event: AgentEvent): Promise<void> {
    this.events.push(event);
  }
  get types() {
    return this.events.map((e) => e.type);
  }
}

export interface UiScript {
  /** Réponse par identifiant d'action (« oui » par défaut). */
  approve?: Record<string, boolean>;
  /** Réponses successives à « entendez-vous du son ? » (« oui » par défaut). */
  heard?: boolean[];
  /** Appelé juste avant chaque demande d'accord, pour vérifier que rien n'a été modifié avant. */
  beforeConfirm?: (action: Action) => void;
}

export class ScriptedUi implements Ui {
  readonly infos: string[] = [];
  readonly proposed: string[] = [];
  readonly questions: string[] = [];
  private heardIndex = 0;

  constructor(private readonly script: UiScript = {}) {}

  info(message: string) {
    this.infos.push(message);
  }

  async confirmAction(action: Action) {
    this.script.beforeConfirm?.(action);
    this.proposed.push(action.id);
    return this.script.approve?.[action.id] ?? true;
  }

  async confirmFixed(question: string) {
    this.questions.push(question);
    const answers = this.script.heard ?? [];
    return answers[this.heardIndex++] ?? true;
  }
}
