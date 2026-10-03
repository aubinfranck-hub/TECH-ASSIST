import type { TaskView } from './chatServer.js';

/** L'état des tâches tel que la fenêtre le montre ; `startedAt` est en millisecondes (horloge du PC du client). */
export interface TaskSnapshot {
  items: TaskView[];
  complete: boolean;
}

/**
 * Envoie au serveur l'avancement de l'intervention pour que le technicien le suive en direct dans sa console.
 * L'état complet est renvoyé à chaque changement, puis toutes les 30 s pendant une tâche : un silence prolongé
 * dit au technicien que le PC est éteint ou hors ligne. Jamais bloquant, jamais d'erreur visible pour le client.
 */
export class ProgressSync {
  private latest: TaskSnapshot | null = null;
  private sending: Promise<void> = Promise.resolve();
  private dirty = false;
  private inflight = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly apiBase: string,
    private readonly token: string,
    private readonly sessionId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly heartbeatMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Nouvel état des tâches. */
  update(snapshot: TaskSnapshot): void {
    if (this.stopped) return;
    this.latest = { items: snapshot.items.map((t) => ({ ...t })), complete: snapshot.complete };
    this.send();
    const running = snapshot.items.some((t) => t.state === 'running');
    if (running && !this.timer) {
      this.timer = setInterval(() => this.send(), this.heartbeatMs);
      this.timer.unref();
    }
    if (!running && this.timer) this.stop(false);
  }

  private body(): string {
    const snap = this.latest!;
    const now = this.now();
    return JSON.stringify({
      complete: snap.complete,
      items: snap.items.map((t) => ({
        id: t.id,
        title: t.title,
        state: t.state,
        min: t.min,
        max: t.max,
        ...(t.state === 'running' && t.startedAt ? { elapsed: Math.max(0, Math.round((now - t.startedAt) / 1000)) } : {}),
        ...(t.state !== 'running' && t.state !== 'pending' && t.seconds !== undefined ? { seconds: Math.round(t.seconds) } : {}),
      })),
    });
  }

  /** Une seule requête à la fois : si l'état change pendant l'envoi, le dernier état part ensuite. */
  private send(): void {
    if (!this.latest) return;
    if (this.inflight) {
      this.dirty = true;
      return;
    }
    this.inflight = true;
    this.sending = (async () => {
      try {
        await this.fetchImpl(`${this.apiBase.replace(/\/$/, '')}/api/app/sessions/${this.sessionId}/progress`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
          body: this.body(),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        /* hors ligne : le prochain envoi rattrape */
      } finally {
        this.inflight = false;
        if (this.dirty) {
          this.dirty = false;
          this.send();
        }
      }
    })();
  }

  /** Attend la fin des envois en cours (avant de fermer le programme). */
  async flush(): Promise<void> {
    while (this.inflight) await this.sending;
  }

  /** Arrête les envois périodiques ; `final` interdit tout envoi ultérieur. */
  stop(final = true): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (final) this.stopped = true;
  }
}
