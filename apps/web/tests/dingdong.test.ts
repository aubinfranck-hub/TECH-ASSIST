import { describe, expect, it } from 'vitest';
import { newRequests } from '../src/lib/dingdong.js';

describe('ding-dong : demandes nouvelles', () => {
  it('au premier chargement, rien n’est nouveau (pas de sonnerie pour les demandes déjà en file)', () => {
    const r = newRequests(null, ['a', 'b']);
    expect(r.fresh).toEqual([]);
    expect([...r.seen]).toEqual(['a', 'b']);
  });
  it('une demande qui arrive sonne une fois', () => {
    const first = newRequests(null, ['a']);
    const second = newRequests(first.seen, ['a', 'b']);
    expect(second.fresh).toEqual(['b']);
    expect(newRequests(second.seen, ['a', 'b']).fresh).toEqual([]);
  });
  it('une demande prise (qui quitte la file) ne sonne pas, et si elle revient elle resonne', () => {
    const a = newRequests(null, ['a', 'b']);
    const b = newRequests(a.seen, ['b']);
    expect(b.fresh).toEqual([]);
    expect(newRequests(b.seen, ['a', 'b']).fresh).toEqual(['a']);
  });
});
