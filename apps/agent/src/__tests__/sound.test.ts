import { describe, expect, it } from 'vitest';
import { COLLECT_SCRIPT, diagnoseSound, parseFacts, type SoundFacts } from '../skills/sound.js';
import { FakeMachine, HEADSET_GUID, SPEAKER_GUID, healthyState } from './fakeMachine.js';

function facts(overrides: Partial<SoundFacts> = {}): SoundFacts {
  return { ...healthyState(), ...overrides };
}

describe('parseFacts', () => {
  const sample = JSON.stringify(healthyState());

  it('lit une sortie normale', () => {
    const parsed = parseFacts(sample);
    expect(parsed.services).toHaveLength(2);
    expect(parsed.endpoints[0]).toMatchObject({ flow: 'Render', guid: SPEAKER_GUID, state: 1 });
    expect(parsed.volume).toBe(0.67);
    expect(parsed.muted).toBe(false);
    expect(parsed.admin).toBe(true);
  });

  it('accepte un objet seul à la place d’une liste (comportement de ConvertTo-Json)', () => {
    const single = JSON.stringify({
      services: { name: 'Audiosrv', status: 'Running' },
      endpoints: { flow: 'Render', guid: SPEAKER_GUID, state: 2, name: 'Speaker' },
      volume: 0.5,
      muted: false,
      admin: false,
    });
    const parsed = parseFacts(single);
    expect(parsed.services).toEqual([{ name: 'Audiosrv', status: 'Running' }]);
    expect(parsed.endpoints).toHaveLength(1);
  });

  it('ignore le BOM et le texte autour du JSON', () => {
    expect(parseFacts(`\uFEFFAvertissement\n${sample}\n`).endpoints).toHaveLength(1);
  });

  it('refuse une sortie illisible', () => {
    expect(() => parseFacts('rien du tout')).toThrow(/illisible/);
    expect(() => parseFacts('{pas du json}')).toThrow();
  });

  it('traite services/périphériques absents comme des listes vides', () => {
    const parsed = parseFacts('{"volume":null,"muted":null,"admin":null}');
    expect(parsed).toEqual({ services: [], endpoints: [], volume: null, muted: null, admin: null });
  });

  it('écarte un volume hors bornes ou d’un mauvais type', () => {
    expect(parseFacts('{"volume":3}').volume).toBeNull();
    expect(parseFacts('{"volume":"0.5"}').volume).toBeNull();
    expect(parseFacts('{"volume":0}').volume).toBe(0);
  });

  it('écarte les périphériques dont l’identifiant n’est pas un GUID (aucune injection possible dans un script)', () => {
    const evil = JSON.stringify({
      endpoints: [
        { flow: 'Render', guid: "{3a1c52f4-0b7e-4e1d-9b5e-6f2d8c1a7e90}'; Remove-Item C:\\ -Recurse #", state: 2, name: 'x' },
        { flow: 'Render', guid: SPEAKER_GUID, state: 2, name: 'Bon' },
        { flow: 'Autre', guid: HEADSET_GUID, state: 2, name: 'Mauvais flux' },
      ],
    });
    expect(parseFacts(evil).endpoints.map((e) => e.name)).toEqual(['Bon']);
  });
});

describe('diagnoseSound', () => {
  it('ne signale rien quand tout est correct', () => {
    const d = diagnoseSound(facts());
    expect(d).toMatchObject({ healthy: true, needsHuman: false, problems: [], actions: [] });
  });

  it('sortie désactivée : propose de la réactiver (cas réel de la machine du fondateur)', () => {
    const d = diagnoseSound(
      facts({ endpoints: [{ flow: 'Render', guid: SPEAKER_GUID, state: 2, name: 'Speaker' }], muted: null, volume: null }),
    );
    expect(d.problems).toEqual(['render_disabled']);
    expect(d.actions.map((a) => a.id)).toEqual(['enable_endpoint']);
    expect(d.actions[0]!.verified).toBe(false);
    expect(d.actions[0]!.requiresAdmin).toBe(true);
    expect(d.summary).toContain('Speaker');
  });

  it('sourdine et volume quasi nul : deux actions', () => {
    const d = diagnoseSound(facts({ muted: true, volume: 0.02 }));
    expect(d.problems).toEqual(['muted', 'volume_low']);
    expect(d.actions.map((a) => a.id)).toEqual(['unmute', 'set_volume']);
  });

  it('volume à exactement 0 : détecté', () => {
    expect(diagnoseSound(facts({ volume: 0 })).problems).toEqual(['volume_low']);
  });

  it('volume ou sourdine illisibles : pas de fausse alerte', () => {
    expect(diagnoseSound(facts({ volume: null, muted: null })).healthy).toBe(true);
  });

  it('service audio arrêté : propose de le démarrer', () => {
    const d = diagnoseSound(
      facts({
        services: [
          { name: 'Audiosrv', status: 'Stopped' },
          { name: 'AudioEndpointBuilder', status: 'Running' },
        ],
      }),
    );
    expect(d.problems).toEqual(['audio_service_stopped']);
    expect(d.actions.map((a) => a.id)).toEqual(['start_audio_services']);
  });

  it('service audio introuvable : passe la main sans rien proposer', () => {
    const d = diagnoseSound(facts({ services: [{ name: 'Audiosrv', status: 'Running' }] }));
    expect(d.problems).toContain('audio_service_missing');
    expect(d.needsHuman).toBe(true);
    expect(d.actions).toEqual([]);
  });

  it('sortie débranchée : conseil, aucune action', () => {
    const d = diagnoseSound(facts({ endpoints: [{ flow: 'Render', guid: SPEAKER_GUID, state: 8, name: 'Casque' }] }));
    expect(d.problems).toEqual(['render_unplugged']);
    expect(d.actions).toEqual([]);
    expect(d.advice.join(' ')).toMatch(/Branchez/);
    expect(d.needsHuman).toBe(false);
  });

  it('aucune carte son : passe la main', () => {
    const d = diagnoseSound(facts({ endpoints: [] }));
    expect(d.problems).toEqual(['no_render_device']);
    expect(d.needsHuman).toBe(true);
  });

  it('une sortie active suffit même si une autre est désactivée', () => {
    const d = diagnoseSound(
      facts({
        endpoints: [
          { flow: 'Render', guid: SPEAKER_GUID, state: 1, name: 'Actif' },
          { flow: 'Render', guid: HEADSET_GUID, state: 2, name: 'Inactif' },
        ],
      }),
    );
    expect(d.healthy).toBe(true);
  });

  it('les micros désactivés ne comptent pas comme un problème de son', () => {
    const d = diagnoseSound(
      facts({
        endpoints: [
          { flow: 'Render', guid: SPEAKER_GUID, state: 1, name: 'Actif' },
          { flow: 'Capture', guid: HEADSET_GUID, state: 2, name: 'Micro' },
        ],
      }),
    );
    expect(d.healthy).toBe(true);
  });

  it('plusieurs sorties désactivées : une proposition par sortie', () => {
    const d = diagnoseSound(
      facts({
        endpoints: [
          { flow: 'Render', guid: SPEAKER_GUID, state: 2, name: 'A' },
          { flow: 'Render', guid: HEADSET_GUID, state: 2, name: 'B' },
        ],
      }),
    );
    expect(d.actions).toHaveLength(2);
  });

  it('prévient quand l’agent n’a pas les droits administrateur', () => {
    const d = diagnoseSound(
      facts({ admin: false, endpoints: [{ flow: 'Render', guid: SPEAKER_GUID, state: 2, name: 'Speaker' }] }),
    );
    expect(d.advice.join(' ')).toMatch(/administrateur/);
  });

  it('refuse de construire une action avec un identifiant qui n’est pas un GUID', () => {
    expect(() =>
      diagnoseSound(facts({ endpoints: [{ flow: 'Render', guid: "x'; calc #", state: 2, name: 'Piégé' }] })),
    ).toThrow(/invalide/);
  });
});

/** Retire le contenu des here-strings @'…'@ : ce qui reste est du PowerShell « nu ». */
function stripHereStrings(script: string) {
  return script.replace(/@'\r?\n[\s\S]*?\r?\n'@/g, '@HERE@');
}

function checkStructure(script: string) {
  const opens = (script.match(/@'$/gm) ?? []).length;
  const closes = (script.match(/^'@$/gm) ?? []).length;
  expect(closes).toBe(opens); // un here-string PowerShell se ferme obligatoirement en début de ligne
  const bare = stripHereStrings(script);
  expect((bare.match(/\{/g) ?? []).length).toBe((bare.match(/\}/g) ?? []).length);
  expect((bare.match(/\(/g) ?? []).length).toBe((bare.match(/\)/g) ?? []).length);
  expect(script.trimEnd().endsWith('}')).toBe(true); // se termine par le « catch » de l'enveloppe
}

describe('scripts PowerShell (contrôle de structure : pas de PowerShell dans cet environnement)', () => {
  it('le script de collecte est bien formé et en lecture seule', () => {
    checkStructure(COLLECT_SCRIPT);
    expect(COLLECT_SCRIPT).not.toMatch(/Set-|Start-|Stop-|Remove-|New-Item|Restart-/);
    expect(COLLECT_SCRIPT).not.toContain('SetVisible');
    expect(COLLECT_SCRIPT).not.toContain('Mute = ');
  });

  it('chaque script d’action est bien formé', async () => {
    const machine = new FakeMachine(healthyState());
    const d = diagnoseSound(
      facts({
        services: [{ name: 'Audiosrv', status: 'Stopped' }, { name: 'AudioEndpointBuilder', status: 'Running' }],
        endpoints: [{ flow: 'Render', guid: SPEAKER_GUID, state: 2, name: 'Speaker' }],
      }),
    );
    const mixed = diagnoseSound(facts({ muted: true, volume: 0.01 }));
    for (const action of [...d.actions, ...mixed.actions]) {
      await action.run(machine);
    }
    expect(machine.modifications.map((c) => c.kind).sort()).toEqual(['enable', 'start_services', 'unmute', 'volume']);
    for (const call of machine.modifications) checkStructure(call.script);
  });

  it('le script de réactivation ne contient que le GUID validé', async () => {
    const machine = new FakeMachine({ ...healthyState(), endpoints: [{ flow: 'Render', guid: SPEAKER_GUID, state: 2, name: "Haut-parleurs d'Éric" }] });
    const d = await diagnoseSound(parseFacts(JSON.stringify(machine.state)));
    await d.actions[0]!.run(machine);
    const script = machine.modifications[0]!.script;
    expect(script).toContain(`{0.0.0.00000000}.${SPEAKER_GUID}`);
    expect(script).not.toContain("d'Éric"); // le nom affiché n'entre jamais dans un script
  });
});
