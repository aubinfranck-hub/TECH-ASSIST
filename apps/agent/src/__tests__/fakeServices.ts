import type { CommandResult, CommandRunner } from '../types.js';
import type { ServiceRecord } from '../skills/services.js';

export interface ServicesState {
  services: ServiceRecord[];
  spoolFiles: number | null;
  spoolOldestMinutes: number | null;
  admin: boolean | null;
}

export const svcRec = (name: string, state: string, startMode = 'Auto', dependsOn: string[] = [], display = name): ServiceRecord => ({
  name,
  display,
  state,
  startMode,
  dependsOn,
});

export function servicesState(services: ServiceRecord[], patch: Partial<ServicesState> = {}): ServicesState {
  return { services, spoolFiles: null, spoolOldestMinutes: null, admin: true, ...patch };
}

export interface ServicesOptions {
  /** Le démarrage de ce service échoue (avec ce message). */
  failStart?: Record<string, string>;
  /** Les actions réussissent mais n'ont aucun effet. */
  noEffect?: boolean;
}

/** Faux Windows pour les services : lit l'état, applique Start-Service / Set-Service / vidage de file. */
export class FakeServices implements CommandRunner {
  readonly calls: { kind: 'collect' | 'start' | 'enable' | 'clear_queue' | 'unknown'; name?: string; script: string }[] = [];

  constructor(
    public state: ServicesState,
    private readonly options: ServicesOptions = {},
  ) {}

  get modifications() {
    return this.calls.filter((c) => c.kind !== 'collect');
  }

  private find(name: string) {
    return this.state.services.find((s) => s.name === name);
  }

  async runPowerShell(script: string): Promise<CommandResult> {
    const ok = (): CommandResult => ({ stdout: 'OK', stderr: '', exitCode: 0 });
    const fail = (stderr: string): CommandResult => ({ stdout: '', stderr, exitCode: 1 });

    if (script.includes('Win32_Service')) {
      this.calls.push({ kind: 'collect', script });
      return { stdout: JSON.stringify(this.state), stderr: '', exitCode: 0 };
    }
    if (script.includes("Stop-Service -Name 'Spooler'")) {
      this.calls.push({ kind: 'clear_queue', script });
      if (!this.options.noEffect) {
        this.state.spoolFiles = 0;
        this.state.spoolOldestMinutes = 0;
      }
      return ok();
    }
    const enable = /Set-Service -Name '([^']+)' -StartupType (Automatic|Manual)/.exec(script);
    if (enable) {
      const name = enable[1]!;
      this.calls.push({ kind: 'enable', name, script });
      const rec = this.find(name);
      if (!rec) return fail(`Service ${name} introuvable`);
      if (!this.options.noEffect) rec.startMode = enable[2] === 'Automatic' ? 'Auto' : 'Manual';
      if (script.includes('Start-Service') && !this.options.noEffect) rec.state = 'Running';
      return ok();
    }
    const start = /Start-Service -Name '([^']+)'/.exec(script);
    if (start) {
      const name = start[1]!;
      this.calls.push({ kind: 'start', name, script });
      const rec = this.find(name);
      if (!rec) return fail(`Service ${name} introuvable`);
      const error = this.options.failStart?.[name];
      if (error) return fail(error);
      if (rec.startMode === 'Disabled') return fail(`Impossible de démarrer ${name} car il est désactivé`);
      if (!this.options.noEffect) rec.state = 'Running';
      return ok();
    }
    this.calls.push({ kind: 'unknown', script });
    return fail('script inattendu');
  }
}
