import { describe, expect, it } from 'vitest';
import { routeIntent } from '../router.js';

const skills = (text: string) =>
  routeIntent(text)
    .filter((i) => i.kind === 'skill')
    .map((i) => (i as { skillId: string }).skillId);
const first = (text: string) => routeIntent(text)[0];

describe('routeur : compétences', () => {
  it.each([
    ["je n'ai plus de son", 'sound'],
    ['pas de son sur mon PC', 'sound'],
    ["mon imprimante n'imprime plus", 'print'],
    ["je n'ai pas Internet", 'network'],
    ['le wifi ne marche pas', 'network'],
    ['mon ordinateur ne se connecte plus au réseau', 'network'],
    ['les mises à jour Windows sont bloquées', 'update'],
    ['mon bluetooth ne marche pas', 'bluetooth'],
    ["l'heure de mon ordinateur est fausse", 'time'],
    ['la barre de recherche windows ne trouve rien', 'search'],
    ['fais une analyse complète', 'windows'],
  ])('« %s » → %s', (text, id) => {
    expect(skills(text)).toContain(id);
  });

  it('virus et logiciels malveillants', () => {
    for (const t of ['je pense avoir un virus', 'mon pc est infecté', "il y a des publicités partout", 'un malware sur mon ordinateur', 'mon antivirus ne marche plus']) {
      expect(skills(t)).toContain('malware');
    }
  });

  it('Office / Outlook : problème → compétence office ; question d’usage → assistant', () => {
    expect(skills('Outlook plante au démarrage')).toContain('office');
    expect(skills('Excel ne répond plus')).toContain('office');
    expect(first('comment faire un publipostage avec Word ?')).toEqual({ kind: 'chat' });
    expect(skills('comment faire un publipostage avec Word ?')).not.toContain('office');
  });

  it('un service désigné par son nom', () => {
    expect(skills('le service Spooler est arrêté')).toContain('service:Spooler');
    expect(skills('service:WSearch')).toContain('service:WSearch');
  });

  it('ne prend pas « service audio » ou « service client » pour un nom de service', () => {
    expect(skills('le service audio ne marche pas').some((s) => s.startsWith('service:'))).toBe(false);
    expect(skills('le service client de ma banque').some((s) => s.startsWith('service:'))).toBe(false);
  });

  it('plusieurs pistes sont toutes renvoyées (le client choisira)', () => {
    expect(skills('mon casque bluetooth ne fait plus de son')).toEqual(expect.arrayContaining(['sound', 'bluetooth']));
    expect(skills("pas d'internet et l'imprimante ne marche plus")).toEqual(expect.arrayContaining(['network', 'print']));
  });
});

describe('routeur : désinstallation', () => {
  it.each([
    ['je veux désinstaller Skype', 'skype'],
    ['désinstalle le logiciel Zoom', 'zoom'],
    ["supprimer l'application TikTok de mon ordinateur", 'tiktok'],
    ['enlever le programme WinRAR svp', 'winrar'],
    ['désinstaller Adobe Reader', 'adobe reader'],
  ])('« %s » → désinstaller « %s »', (text, query) => {
    expect(first(text)).toEqual({ kind: 'uninstall', query });
  });

  it('« supprimer » un fichier, un mail ou une page n’est pas une désinstallation', () => {
    for (const t of ['supprimer un fichier', 'supprimer mes mails', 'comment supprimer une page dans Word', 'effacer la photo']) {
      expect(routeIntent(t).some((i) => i.kind === 'uninstall')).toBe(false);
    }
  });

  it('« supprimer le virus » mène à l’analyse, pas à la désinstallation', () => {
    const intents = routeIntent('supprimer le virus de mon ordinateur');
    expect(intents.some((i) => i.kind === 'uninstall')).toBe(false);
    expect(skills('supprimer le virus de mon ordinateur')).toContain('malware');
  });
});

describe('routeur : urgences et cas limites', () => {
  it('rançongiciel : intervention humaine, aucune compétence', () => {
    for (const t of ['tous mes fichiers sont chiffrés et on me demande une rançon', 'ransomware', 'mes fichiers sont verrouillés, il faut payer']) {
      expect(routeIntent(t)).toEqual([{ kind: 'emergency' }]);
    }
  });

  it('une question libre va à l’assistant', () => {
    expect(first("c'est quoi un pare-feu ?")).toEqual({ kind: 'chat' });
    expect(first('pourquoi mon PC chauffe')).toEqual({ kind: 'chat' });
  });

  it('un texte incompris ne renvoie rien', () => {
    expect(routeIntent('bonjour')).toEqual([]);
    expect(routeIntent('')).toEqual([]);
  });

  it('insensible à la casse et aux accents', () => {
    expect(skills("IMPRIMANTE EN PANNE")).toContain('print');
    expect(skills('Réseau coupé')).toContain('network');
  });
});

describe('veille et verrouillage', () => {
  it("route « mon ordinateur va en veille et il faut Ctrl Alt Supp » vers la compétence power", () => {
    const ids = routeIntent("mon ordinateur va en veille et pour ressortir il faut forcement control alt supp sans cela rien")
      .filter((i) => i.kind === 'skill')
      .map((i) => (i as { skillId: string }).skillId);
    expect(ids).toContain('power');
  });
});
