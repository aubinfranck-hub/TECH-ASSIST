import type { Response } from 'express';

/**
 * Flux temps réel des applications technicien (Windows, Android) : chaque application ouvre UNE connexion (SSE) et reçoit, au même instant,
 * les événements. Rien n'est à interroger : « request » (un client demande un technicien), « taken » (un confrère l'a prise),
 * « snapshot » (la file complète, au début puis toutes les 30 s : rattrape ce qu'une coupure réseau a fait manquer), « ping ».
 * Le serveur n'a qu'une instance : le concentrateur est en mémoire.
 */
export interface WaitingRequest {
  id: string;
  platform: string;
  who: string;
  reason: string;
  at: string;
}

export type HubEvent =
  | { type: 'hello'; onDuty: boolean }
  | { type: 'request'; request: WaitingRequest }
  | { type: 'taken'; sessionId: string; by: string }
  | { type: 'snapshot'; queue: WaitingRequest[] }
  | { type: 'ping' };

interface Client {
  technicianId: string;
  res: Response;
}

const clients = new Set<Client>();

export function frame(event: HubEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function send(client: Client, event: HubEvent): void {
  try {
    client.res.write(frame(event));
  } catch {
    clients.delete(client);
  }
}

export function connectedCount(): number {
  return clients.size;
}

/** Ajoute une connexion ; renvoie la fonction qui la retire. */
export function register(technicianId: string, res: Response): { send: (event: HubEvent) => void; remove: () => void } {
  const client: Client = { technicianId, res };
  clients.add(client);
  return { send: (event) => send(client, event), remove: () => void clients.delete(client) };
}

/** Une demande arrive : tous les techniciens de permanence connectés la reçoivent au même instant. */
export function broadcastRequest(technicianIds: readonly string[], request: WaitingRequest): number {
  const wanted = new Set(technicianIds);
  let n = 0;
  for (const c of clients) {
    if (!wanted.has(c.technicianId)) continue;
    send(c, { type: 'request', request });
    n++;
  }
  return n;
}

/** Un technicien a pris la demande : les autres retirent leur alerte. */
export function broadcastTaken(sessionId: string, by: string): void {
  for (const c of clients) send(c, { type: 'taken', sessionId, by });
}

export function broadcastSnapshot(queue: WaitingRequest[]): void {
  for (const c of clients) send(c, { type: 'snapshot', queue });
}

export function broadcastPing(): void {
  for (const c of clients) send(c, { type: 'ping' });
}

/** Pour les tests. */
export function resetHub(): void {
  clients.clear();
}
