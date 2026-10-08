import { createSseParser } from './sse.js';

export type StreamState = 'connecting' | 'open' | 'retrying' | 'unauthorized';

export interface StreamOptions {
  base: string;
  token: string;
  onEvent: (event: string, data: Record<string, unknown>) => void;
  onState?: (state: StreamState) => void;
  fetchImpl?: typeof fetch;
  /** Attentes entre deux tentatives (ms) ; tests : très courtes. */
  backoff?: number[];
}

/**
 * Flux temps réel de la console technicien : chaque nouvelle demande arrive tout de suite (sans attendre la prochaine interrogation).
 * Se reconnecte tout seul (1 s, 2 s, 5 s … 30 s) ; un jeton refusé (401) arrête les tentatives. Renvoie la fonction d'arrêt.
 */
export function startTechnicianStream(options: StreamOptions): () => void {
  const doFetch = options.fetchImpl ?? fetch;
  const waits = options.backoff ?? [1000, 2000, 5000, 10000, 30000];
  let stopped = false;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const state = (s: StreamState) => options.onState?.(s);

  async function run(): Promise<void> {
    if (stopped) return;
    state('connecting');
    controller = new AbortController();
    try {
      const res = await doFetch(`${options.base}/api/technician/stream`, {
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'text/event-stream' },
        signal: controller.signal,
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) {
        state('unauthorized');
        return;
      }
      if (!res.ok || !res.body) throw new Error(`flux ${res.status}`);
      state('open');
      attempt = 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
          try {
            options.onEvent(ev.event, JSON.parse(ev.data) as Record<string, unknown>);
          } catch {
            /* événement illisible : ignoré */
          }
        }
      }
    } catch {
      /* coupure : on retente ci-dessous */
    }
    if (stopped) return;
    state('retrying');
    const wait = waits[Math.min(attempt, waits.length - 1)]!;
    attempt++;
    timer = setTimeout(() => void run(), wait);
  }

  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}
