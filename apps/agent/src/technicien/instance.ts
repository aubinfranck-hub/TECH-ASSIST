import { createServer, type Server } from 'node:net';

/** Une seule application technicien à la fois : le port local sert de verrou (le système le libère tout seul si le programme s'arrête). */
export const INSTANCE_PORT = 47213;

export interface InstanceLock {
  release: () => Promise<void>;
}

export function acquireInstanceLock(port: number = INSTANCE_PORT): Promise<InstanceLock | null> {
  return new Promise((resolve) => {
    const server: Server = createServer();
    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => {
      resolve({ release: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}
