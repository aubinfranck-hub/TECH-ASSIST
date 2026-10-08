/** Lecture d'un flux « text/event-stream » reçu par morceaux (fetch + ReadableStream) : renvoie les événements complets, garde le reste. */
export interface SseEvent {
  event: string;
  data: string;
}

export function createSseParser(): { push: (chunk: string) => SseEvent[] } {
  let buffer = '';
  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk.replace(/\r\n/g, '\n');
      const out: SseEvent[] = [];
      let i: number;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith(':')) continue; // commentaire (battement)
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length > 0) out.push({ event, data: data.join('\n') });
      }
      return out;
    },
  };
}
