import { describe, expect, it } from 'vitest';
import { cleanStderr } from '../powershell.js';
import { CompositeReporter, HttpReporter } from '../reporters.js';
import type { AgentEvent } from '../types.js';

const event: AgentEvent = { type: 'action_done', skill: 'sound', action: 'unmute', message: 'OK' };

describe('HttpReporter', () => {
  it('envoie l’événement à la session avec le jeton de l’application', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    await new HttpReporter('https://api.example.com/', 'jeton-app', 'sess-1', fakeFetch).event(event);

    expect(seen[0]!.url).toBe('https://api.example.com/api/app/sessions/sess-1/events');
    expect(seen[0]!.init.method).toBe('POST');
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer jeton-app');
    expect(JSON.parse(seen[0]!.init.body as string)).toEqual(event);
  });

  it('signale une réponse en erreur', async () => {
    const fakeFetch = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    await expect(new HttpReporter('https://x', 't', 's', fakeFetch).event(event)).rejects.toThrow(/403/);
  });
});

describe('CompositeReporter', () => {
  it('prévient tous les destinataires même si l’un échoue, puis remonte l’erreur', async () => {
    const got: string[] = [];
    const composite = new CompositeReporter([
      { event: async () => { throw new Error('panne'); } },
      { event: async (e) => { got.push(e.type); } },
    ]);
    await expect(composite.event(event)).rejects.toThrow('panne');
    expect(got).toEqual(['action_done']);
  });
});

describe('cleanStderr', () => {
  it('laisse un message simple tel quel', () => {
    expect(cleanStderr('Accès refusé')).toBe('Accès refusé');
  });

  it('extrait le texte lisible d’une erreur CLIXML', () => {
    const clixml =
      '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
      '<S S="Error">Le terme _x0027_Foo_x0027_ n_x0027_est pas reconnu_x000D__x000A_</S>' +
      '<S S="Error">Ligne &lt;1&gt;_x000D__x000A_</S></Objs>';
    expect(cleanStderr(clixml)).toContain("Le terme 'Foo' n'est pas reconnu");
    expect(cleanStderr(clixml)).toContain('Ligne <1>');
  });

  it('garde le texte brut si le CLIXML ne contient aucune erreur lisible', () => {
    expect(cleanStderr('#< CLIXML\n<Objs></Objs>')).toContain('CLIXML');
  });
});
