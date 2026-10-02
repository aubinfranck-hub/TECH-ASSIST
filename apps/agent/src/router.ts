/**
 * Comprend ce que le client écrit et le relie à une compétence de l'agent.
 *
 * Ce routeur est à règles (mots-clés français). Il ne décide que DE QUELLE compétence il s'agit,
 * jamais de ce qu'il faut exécuter : un modèle d'IA pourra le remplacer plus tard sans élargir
 * ce que l'agent a le droit de faire.
 */

export type Intent =
  | { kind: 'skill'; skillId: string }
  | { kind: 'uninstall'; query: string }
  | { kind: 'emergency' }
  | { kind: 'chat' };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'");

const NOT_PROGRAM = /\b(fichier|dossier|photo|image|video|mail|message|courriel|document|contact|compte|mot de passe|historique|cache|cookie|ligne|texte|page|tableau|cellule|colonne|formule|signature)s?\b/;
const MALWARE = /\b(virus|malware|malveillant|trojan|cheval de troie|spyware|logiciel espion|adware|publicites? (intempestives?|partout|envahissantes?)|pop-?ups?|pirat|infecte|hacke|rootkit|keylogger)\w*/;
const OFFICE = /\b(outlook|office|word|excel|powerpoint|messagerie|onenote|access)\b/;
const HOWTO = /\b(comment|astuce|tutoriel|explique|expliquer|apprendre|formule|tableau croise|publipostage|mise en forme|mise en page|raccourci|inserer|fusionner|trier|filtrer|imprimer un|creer un|ajouter une?|modifier la)\b/;
const OFFICE_PROBLEM = /\b(plante|plantage|bloque|bloquee?|fige|figee|gele|crash|ne repond|repond plus|ne s'ouvre|s'ouvre pas|ne demarre|demarre pas|ferme tout seul|se ferme|erreur|lent|lente|lag|ne marche|marche pas|ne fonctionne|fonctionne pas|probleme)\b/;

const SKILL_RULES: { skillId: string; pattern: RegExp }[] = [
  { skillId: 'windows', pattern: /\b(analyse (complete|globale)|verifi\w* tout|tout verifier|diagnostic complet|check-?up)\b/ },
  { skillId: 'network', pattern: /\b(internet|wi-?fi|reseau|connexion|ethernet|dns|box|navigu\w*|wlan|pas de connexion)\b/ },
  { skillId: 'print', pattern: /\b(imprim\w*|spool\w*)\b/ },
  { skillId: 'sound', pattern: /\b(pas de son|plus de son|sans son|aucun son|le son|du son|audio|haut-?parleurs?|enceintes?|casque|volume|muet|sourdine|entends?|ecouter)\b/ },
  { skillId: 'update', pattern: /\b(mises? a jour|windows update|update)\b/ },
  { skillId: 'bluetooth', pattern: /\bbluetooth\b/ },
  { skillId: 'search', pattern: /\b(recherche windows|barre de recherche|rechercher dans windows)\b/ },
  { skillId: 'time', pattern: /\b(heure|horloge|fuseau|date (fausse|incorrecte|erronee))\b/ },
];

/** Nom de service explicitement donné (« le service Spooler », « service:Spooler ») ; jamais deviné. */
const SERVICE_STOPWORDS = new Set(['audio', 'windows', 'reseau', 'internet', 'impression', 'client', 'de', 'du', 'la', 'le', 'les', 'des', 'un', 'une', 'wifi', 'son', 'mise', 'update', 'bluetooth']);

function explicitService(original: string): string | null {
  const m = /\bservice[:\s]+([A-Za-z][A-Za-z0-9_.-]{1,39})\b/i.exec(original);
  if (!m) return null;
  return SERVICE_STOPWORDS.has(m[1]!.toLowerCase()) ? null : m[1]!;
}

function uninstallQuery(text: string): string | null {
  const m = /\b(desinstall\w*|supprim\w*|enlev\w*|retir\w*|vir(?:er)?|effac\w*)\s+(?:(?:(?:le|la|les|un|une|ce|cet|cette|mon|ma|mes|nos|vos)\s+)|l')?(?:(?:logiciel|programme|application|appli|app)\s+)?(?:(?:de|d')\s*)?([^,.;!?]+)/.exec(
    text,
  );
  if (!m) return null;
  const verbIsUninstall = m[1]!.startsWith('desinstall');
  let query = m[2]!
    .replace(/\b(de mon ordinateur|de mon pc|de l'ordinateur|de mon portable|svp|s'il vous plait|s'il te plait|merci|completement|definitivement)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (query.length < 2) return null;
  // « supprimer » n'est une désinstallation que s'il vise un logiciel (pas un fichier, un mail, une page…).
  if (!verbIsUninstall && NOT_PROGRAM.test(`${m[1]} ${query}`)) return null;
  // « supprimer le virus » est une demande d'analyse, pas une désinstallation.
  if (MALWARE.test(query)) return null;
  return query;
}

/** Les compétences et actions qui correspondent, les plus prioritaires d'abord (vide : question libre ou incompris). */
export function routeIntent(original: string): Intent[] {
  const text = fold(original);
  const out: Intent[] = [];
  const add = (intent: Intent) => {
    const same = (a: Intent) => a.kind === intent.kind && (a.kind !== 'skill' || a.skillId === (intent as { skillId: string }).skillId);
    if (!out.some(same)) out.push(intent);
  };

  // Urgence : un rançongiciel ne se « répare » pas à l'aveugle.
  if (/\b(rancon\w*|ransomware|crypto-?locker)\b/.test(text) || (/\bfichiers?\b/.test(text) && /\b(chiffre\w*|crypte\w*|verrouille\w*)\b/.test(text))) {
    return [{ kind: 'emergency' }];
  }

  const service = explicitService(original);
  if (service) add({ kind: 'skill', skillId: `service:${service}` });

  const query = uninstallQuery(text);
  if (query) add({ kind: 'uninstall', query });

  if (MALWARE.test(text) || /\bantivirus\b/.test(text)) add({ kind: 'skill', skillId: 'malware' });

  if (OFFICE.test(text)) {
    const howTo = HOWTO.test(text);
    const problem = OFFICE_PROBLEM.test(text);
    if (problem || !howTo) add({ kind: 'skill', skillId: 'office' });
    if (howTo || !problem) add({ kind: 'chat' });
  }

  for (const rule of SKILL_RULES) if (rule.pattern.test(text)) add({ kind: 'skill', skillId: rule.skillId });

  if (out.length === 0 && (/\?/.test(original) || /^(comment|pourquoi|qu'est-ce|c'est quoi|peux-tu|pouvez-vous|est-ce que|quel)/.test(text))) {
    add({ kind: 'chat' });
  }
  return out;
}
