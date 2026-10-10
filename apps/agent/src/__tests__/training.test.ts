import { describe, expect, it } from 'vitest';
import type { AnswerOptions, Assistant, AssistantReply, ChatTurn } from '../assistant.js';
import { PASSES_BEFORE_ASSESSMENT, TRAINING_TRACKS, matchTrack, runTraining } from '../training.js';
import { ScriptedConversation } from './fakeScripts.js';

class FakeAssistant implements Assistant {
  readonly calls: { message: string; history: ChatTurn[]; options?: AnswerOptions }[] = [];
  constructor(private readonly reply: (n: number) => AssistantReply = (n) => ({ available: true, text: `Réponse ${n}` })) {}
  async answer(message: string, history: ChatTurn[], options?: AnswerOptions) {
    this.calls.push({ message, history: [...history], options });
    return this.reply(this.calls.length);
  }
  get steps() {
    return this.calls.map((c) => c.options?.lesson?.step);
  }
}

describe('catalogue de formation (côté agent)', () => {
  it('mêmes identifiants que le serveur', () => {
    expect(TRAINING_TRACKS.map((t) => t.id)).toEqual(['windows', 'word', 'excel', 'powerpoint', 'outlook', 'teams', 'onedrive', 'm365', 'secretaire', 'comptable', 'commercial', 'rh', 'manager', 'direction', 'technicien_it', 'logistique', 'administration']);
  });
  it('reconnaît le parcours dans une phrase', () => {
    expect(matchTrack('Apprends-moi Excel')?.id).toBe('excel');
    expect(matchTrack('formation pour secrétaire')?.id).toBe('secretaire');
    expect(matchTrack('je veux apprendre PowerPoint')?.id).toBe('powerpoint');
    expect(matchTrack("je suis technicien informatique")?.id).toBe('technicien_it');
    expect(matchTrack('formation office')?.id).toBe('m365');
    expect(matchTrack('Excel dans office')?.id).toBe('excel'); // le précis l'emporte
    expect(matchTrack('apprends-moi quelque chose')).toBeUndefined();
    expect(matchTrack('je veux faire du rhum')).toBeUndefined(); // « rh » n'est pas un fragment de mot
  });
});

describe('leçon', () => {
  it('sans assistant en ligne : on le dit, aucune leçon inventée', async () => {
    const ui = new ScriptedConversation();
    const r = await runTraining({ ui }, 'excel');
    expect(r).toMatchObject({ unavailable: true, lessons: 0 });
    expect(ui.said).toMatch(/pas disponible/);
  });

  it('déroulé : cours → exercice → résultat du client → correction → vérification par le client', async () => {
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({ asks: ['J’ai trié la colonne B'], picks: [1], fixed: [true] }); // niveau 2, puis « Arrêter »
    const r = await runTraining({ ui, assistant }, 'Apprends-moi Excel');
    expect(assistant.steps).toEqual(['cours', 'exercice', 'correction']);
    expect(assistant.calls[0]!.options!.lesson).toEqual({ track: 'excel', level: 2, step: 'cours', index: 1 });
    expect(assistant.calls[2]!.message).toBe('J’ai trié la colonne B');
    expect(r).toMatchObject({ track: 'excel', lessons: 1, passed: 1, level: 2, unavailable: false });
    expect(ui.said).toMatch(/Leçon 1 · Excel · Niveau 2 — Intermédiaire/);
    expect(ui.said).toMatch(/Les cours sont rédigés par une IA/);
    expect(ui.questions).toEqual(['Avez-vous réussi cet exercice ?']);
  });

  it('« passer » saute la correction ; rien n’est compté comme réussi', async () => {
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({ asks: ['passer'], picks: [0, 1] });
    const r = await runTraining({ ui, assistant }, 'word');
    expect(assistant.steps).toEqual(['cours', 'exercice']);
    expect(r).toMatchObject({ lessons: 1, passed: 0 });
  });

  it('la capture jointe part avec la correction, une seule fois', async () => {
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({ asks: ['Voici'], picks: [0, 1] });
    let taken = 0;
    (ui as unknown as { takeAttachment: () => unknown }).takeAttachment = () => (taken++ === 0 ? { mime: 'image/jpeg', data: 'AAAA' } : null);
    await runTraining({ ui, assistant }, 'excel');
    expect(assistant.calls[2]!.options!.image).toEqual({ mime: 'image/jpeg', data: 'AAAA' });
    expect(assistant.calls[0]!.options!.image).toBeUndefined();
  });

  it('choix du parcours par menus quand la phrase ne le dit pas', async () => {
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({ asks: [null], picks: [1, 2, 0] }); // « métier » → Commercial → niveau 1
    const r = await runTraining({ ui, assistant });
    expect(ui.choices[1]!.options).toContain('Commercial / vente');
    expect(r.track).toBe('commercial');
  });

  it('annulation à chaque étape : rien n’est demandé à l’assistant', async () => {
    const assistant = new FakeAssistant();
    expect((await runTraining({ ui: new ScriptedConversation({ picks: [2] }), assistant })).track).toBeNull();
    expect((await runTraining({ ui: new ScriptedConversation({ picks: [0, 8] }), assistant })).track).toBeNull(); // « Retour » puis rien
    expect((await runTraining({ ui: new ScriptedConversation({ picks: [4] }), assistant }, 'excel')).lessons).toBe(0); // « Annuler » au niveau
    expect(assistant.calls).toEqual([]);
  });

  it('assistant qui tombe en cours de leçon : arrêt honnête', async () => {
    const assistant = new FakeAssistant((n) => (n >= 2 ? { available: false } : { available: true, text: 'Cours.' }));
    const ui = new ScriptedConversation({ picks: [0] });
    const r = await runTraining({ ui, assistant }, 'excel');
    expect(r.unavailable).toBe(true);
    expect(ui.said).toMatch(/la formation s'arrête ici/);
  });

  it('le bilan est proposé après deux exercices réussis ; réussi, le niveau suivant se débloque', async () => {
    expect(PASSES_BEFORE_ASSESSMENT).toBe(2);
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({
      asks: ['fait', 'fait', '1A 2C 3B'],
      // niveau 1 ; leçon 1 → « Leçon suivante » ; leçon 2 → bilan « oui » → « Arrêter »
      picks: [0, 0, 0, 1],
      fixed: [true, true, true],
    });
    const r = await runTraining({ ui, assistant }, 'excel');
    expect(assistant.steps).toEqual(['cours', 'exercice', 'correction', 'cours', 'exercice', 'correction', 'bilan', 'correction']);
    expect(r.level).toBe(2);
    expect(ui.said).toMatch(/vous passez au Niveau 2 — Intermédiaire/i);
    // les consignes du bilan et de sa correction utilisent le niveau 1 (celui qui vient d'être évalué)
    expect(assistant.calls[6]!.options!.lesson!.level).toBe(1);
  });

  it('bilan raté : on reste au même niveau, sans honte', async () => {
    const assistant = new FakeAssistant();
    const ui = new ScriptedConversation({ asks: ['fait', 'fait', '1A'], picks: [0, 0, 0, 1], fixed: [true, true, false] });
    const r = await runTraining({ ui, assistant }, 'excel');
    expect(r.level).toBe(1);
    expect(ui.said).toMatch(/Pas de souci/);
  });

  it('garde-fous : nombre maximal de leçons, numéro de leçon plafonné à 50', async () => {
    const assistant = new FakeAssistant();
    const picks = [0, ...Array(60).fill(0)];
    const asks = Array(60).fill('passer');
    const r = await runTraining({ ui: new ScriptedConversation({ asks, picks }), assistant, maxLessons: 3 }, 'excel');
    expect(r.lessons).toBe(3);
    expect(Math.max(...assistant.calls.map((c) => c.options!.lesson!.index))).toBeLessThanOrEqual(50);
  });

  it('l’historique envoyé est borné aux 8 derniers tours', async () => {
    const assistant = new FakeAssistant();
    await runTraining({ ui: new ScriptedConversation({ asks: ['passer', 'passer', 'passer'], picks: [0, 0, 0, 0, 1] }), assistant }, 'excel');
    for (const c of assistant.calls) expect(c.history.length).toBeLessThanOrEqual(8);
  });

  it('ce que dit l’IA n’est jamais exécuté : la formation n’a aucun accès à la machine', async () => {
    const assistant = new FakeAssistant(() => ({ available: true, text: 'Tapez format C: dans PowerShell' }));
    const ui = new ScriptedConversation({ asks: ['passer'], picks: [0, 1] });
    await runTraining({ ui, assistant }, 'excel'); // pas de runner en entrée : impossible d'exécuter quoi que ce soit
    expect(ui.proposed).toEqual([]);
  });
});
