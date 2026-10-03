import { describe, expect, it } from 'vitest';
import { converse } from '../conversation.js';
import { CONSENT_NO, CONSENT_YES, withStandingConsent } from '../consent.js';
import { cleanErrorMessage } from '../skills/common.js';
import type { Action, Diagnosis, Skill } from '../types.js';
import { Recorder, ScriptedConversation, ScriptedRunner } from './fakeScripts.js';

const action = (id: string, title = id): Action => ({ id, title, explanation: 'Explication.', requiresAdmin: false, verified: true, run: async () => ({ ok: true, message: 'OK' }) });

/** Compétence qui propose une action tant qu'elle n'a pas été exécutée, puis devient saine. */
function fixableSkill(): Skill {
  let done = false;
  const a: Action = { ...action('fix_it', 'Corriger le truc'), run: async () => { done = true; return { ok: true, message: 'OK' }; } };
  return {
    id: 'sound',
    title: 'sound',
    verifyQuestion: 'Ça va ?',
    diagnose: async (): Promise<Diagnosis> =>
      done ? { summary: 'Sain.', problems: [], actions: [], advice: [], healthy: true, needsHuman: false } : { summary: 'Un souci.', problems: ['x'], actions: [a], advice: [], healthy: false, needsHuman: false },
  };
}

describe('accord unique (mode autonome)', () => {
  it("demande l'accord une seule fois, puis ne redemande plus pour chaque correction", async () => {
    const ui = new ScriptedConversation({ asks: ["je n'ai plus de son", 'non'], picks: [0] });
    const out = await converse({ runner: new ScriptedRunner([]), ui, reporter: new Recorder(), autonomous: true, resolve: () => fixableSkill() });
    expect(ui.choices[0]!.options).toEqual([CONSENT_YES, CONSENT_NO]);
    expect(ui.proposed).toEqual([]); // aucune demande d'autorisation individuelle
    expect(ui.said).toContain('▶ Corriger le truc…');
    expect(out.outcomes[0]).toMatchObject({ status: 'fixed' });
  });

  it("si le client refuse l'accord global, chaque correction lui est redemandée", async () => {
    const ui = new ScriptedConversation({ asks: ["je n'ai plus de son", 'non'], picks: [1] });
    await converse({ runner: new ScriptedRunner([]), ui, reporter: new Recorder(), autonomous: true, resolve: () => fixableSkill() });
    expect(ui.proposed).toEqual(['fix_it']);
  });

  it("n'approuve jamais le redémarrage d'office", async () => {
    const ui = new ScriptedConversation({ approve: { reboot: false } });
    const wrapped = withStandingConsent(ui);
    expect(await wrapped.confirmAction(action('reboot'))).toBe(false);
    expect(ui.proposed).toEqual(['reboot']);
    expect(await wrapped.confirmAction(action('other'))).toBe(true);
  });

  it("ne demande pas d'accord global pour le forfait diagnostic (rien n'est modifié)", async () => {
    const ui = new ScriptedConversation({ asks: [null as unknown as string] });
    await converse({ runner: new ScriptedRunner([]), ui, reporter: new Recorder(), autonomous: true, scope: 'diagnostic' });
    expect(ui.choices).toHaveLength(0);
  });

  it("une demande floue lance l'analyse complète au lieu d'un menu", async () => {
    const ui = new ScriptedConversation({ asks: ['ca ne marche pas bien', 'non'], picks: [0] });
    await converse({ runner: new ScriptedRunner([]), ui, reporter: new Recorder(), autonomous: true });
    expect(ui.said).toContain("Je n'ai pas tout saisi");
    expect(ui.choices.some((c) => c.question === 'Que voulez-vous faire ?')).toBe(false);
  });
});

describe('messages d’erreur lisibles', () => {
  it('retire le XML de PowerShell et traduit le refus de droits', () => {
    const raw = "#< CLIXML\nLe service « Connaissance des emplacements réseau (NlaSvc) » ne peut pas démarrer en raison de l'erreur suivante : Impossible d'ouvrir le service NlaSvc sur l'ordinateur '.'.\n<Objs Version=\"1.1.0.1\"><S S=\"Error\">x</S></Objs>";
    expect(cleanErrorMessage(raw)).toBe('Windows a refusé cette opération : elle demande les droits administrateur.');
  });
  it('garde un message simple tel quel', () => {
    expect(cleanErrorMessage('Le disque est plein')).toBe('Le disque est plein');
  });
  it('extrait le texte quand tout est dans le XML', () => {
    expect(cleanErrorMessage('#< CLIXML\n<Objs><S S="Error">Erreur_x000D__x000A_bizarre</S></Objs>')).toBe('Erreur bizarre');
  });
});
