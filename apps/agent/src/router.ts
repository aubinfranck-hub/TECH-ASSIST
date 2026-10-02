/**
 * Comprend ce que le client écrit et le relie à une compétence de l'agent.
 *
 * Ce routeur est à règles (mots-clés français). Il ne décide que DE QUELLE compétence il s'agit,
 * jamais de ce qu'il faut exécuter : un modèle d'IA pourra le remplacer plus tard sans élargir
 * ce que l'agent a le droit de faire.
 */

import { INSTALL_CATALOG } from './skills/install.js';

export type HumanOnlyTopic = 'infrastructure' | 'fleet' | 'accounts';

export type Intent =
  | { kind: 'skill'; skillId: string }
  | { kind: 'uninstall'; query: string }
  /** « Réparer mon PC » : analyse complète puis corrections. */
  | { kind: 'repair' }
  /** Accès à un serveur ; `host` seulement s'il est explicite dans la phrase (jamais deviné). */
  | { kind: 'server'; host?: string }
  | { kind: 'mapdrive'; letter?: string; unc?: string }
  /** Installation d'un logiciel du catalogue ; `app` seulement si reconnu. */
  | { kind: 'install'; app?: string }
  | { kind: 'training'; topic: string }
  /** Hors de portée de l'agent (routeurs, domaine, comptes, parc d'ordinateurs) : un technicien ou l'espace entreprise. */
  | { kind: 'human_only'; topic: HumanOnlyTopic }
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

const INFRASTRUCTURE = /\b(routeurs?|routers?|switch(es)?|commutateurs?|firewall|vpn|vlan|active directory|controleur de domaine|gpo|strategie de groupe|mikrotik|ubiquiti|unifi|tp-?link|cisco|fortinet|fortigate|aruba|huawei|windows server|dhcp|points? d'acces|infrastructure|datacenter)\b/;
const FLEET = /\b(tous les (pc|ordinateurs|postes|ordis)|tout le parc|le parc|parc informatique|flotte|ensemble des (pc|ordinateurs|postes)|plusieurs (pc|ordinateurs|postes)|chaque (pc|poste))\b/;
const ACCOUNTS = /\b(mot de passe|mdp|creer un (compte|utilisateur)|ajoute\w* un utilisateur|nouvel? utilisateur|compte utilisateur|droits? d'acces|permissions?|bureau a distance|rdp|reinitialis\w* (le |mon )?(mot|compte))\b/;
const REPAIR = /\b(repar\w* (mon|le|cet|ce) (pc|ordinateur|ordi|portable)|repare mon pc|maintenance|optimis\w*|(mon|le|cet|ce) (pc|ordinateur|ordi|portable|machine) (est|devient) (tres |trop |super )?(lent|lente|lents)|ordinateur (lent|lente)|pc (lent|lente)|ca rame|\brame\b|trop lent|tres lent|mon pc ne va pas|prends? soin de mon (pc|ordinateur))\b/;
const SERVER_WORD = /\bserveurs?\b/;
const SERVER_PROBLEM = /\b(acces|acceder|accede|joindre|joins|joint|atteindre|atteins|inaccessible|injoignable|connecter|connexion|repond|marche|fonctionne|partage|dossier|lent|verifie|verifier|ping|ouvre)\b/;
const MAPDRIVE = /\b(lecteur reseau|(connect\w*|monter|mapper|ajout\w*) (le |un )?(lecteur|dossier partage|partage)|mapper|dossier partage|partage reseau|disque reseau|lecteur [d-z]:)/;
const INSTALL = /\b(install\w*|telecharg\w*)\b/;
const TRAINING = /\b(apprend\w*|apprentissage|formation|former|formateur|cours|lecons?|tutoriel|m'entrainer|entrainement|debutant|initiation|se former|me former)\b/;
const SCREENSHOT = /\b(capture d'ecran|capture|screenshot|je suis bloque(e)?|cet ecran|ce message d'erreur)\b/;
const MEMORY_CPU = /\b(memoire|ram|processeur|cpu|surchauffe\w*|ventilateur)\b/;

const SKILL_RULES: { skillId: string; pattern: RegExp }[] = [
  { skillId: 'windows', pattern: /\b(analyse (complete|globale)|verifi\w* tout|tout verifier|diagnostic complet|check-?up)\b/ },
  { skillId: 'lan-map', pattern: /\b(cartographie|carte du reseau|appareils? (connectes?|sur (le|mon) reseau)|qui est connecte|qui utilise mon (wi-?fi|reseau)|qui (se )?connecte (a|sur) mon)\b/ },
  { skillId: 'network', pattern: /\b(internet|wi-?fi|reseau|connexion|ethernet|dns|box|navigu\w*|wlan|pas de connexion)\b/ },
  { skillId: 'print', pattern: /\b(imprim\w*|spool\w*)\b/ },
  { skillId: 'performance', pattern: MEMORY_CPU },
  { skillId: 'startup', pattern: /\b(au demarrage|demarrage (lent|long)|met (du temps|longtemps) a demarrer|programmes? qui se lancent)\b/ },
  { skillId: 'disk', pattern: /\b(disque|stockage|espace (libre|disque)|ssd|hdd|disque (plein|dur)|plus de place)\b/ },
  { skillId: 'cleanup', pattern: /\b(nettoi\w*|nettoy\w*|liberer (de la )?place|corbeille|fichiers? temporaires?)\b/ },
  { skillId: 'drivers', pattern: /\b(pilotes?|drivers?|peripheriques?|webcam|camera|micro(phone)?|clavier|souris|ecran externe|usb|cle usb|scanner|scanneur|manette)\b/ },
  { skillId: 'crashes', pattern: /\b(ecran bleu|bsod|redemarre (tout )?seul|redemarrages? (tout )?seuls?|s'eteint (tout )?seul|plantages? (tout )?seuls?|redemarre sans raison|plante tout le temps)\b/ },
  { skillId: 'security', pattern: /\b(pare-?feu|firewall|defender|securite|protection)\b/ },
  { skillId: 'windows-repair', pattern: /\b(sfc|dism|fichiers? systeme|windows (est )?(corrompu|abime|endommage)|reparer windows)\b/ },
  { skillId: 'battery', pattern: /\b(batterie|autonomie|se decharge)\b/ },
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

/** Adresse IPv4, nom complet (avec un point) ou chemin \\\\nom : jamais un mot deviné après « serveur ». */
function explicitHost(original: string): string | undefined {
  const unc = /\\\\([A-Za-z0-9][A-Za-z0-9.-]{0,62})/.exec(original);
  if (unc) return unc[1];
  const ip = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/.exec(original);
  if (ip) return ip[1];
  const fqdn = /\b([A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)+)\b/.exec(original);
  if (fqdn) return fqdn[1];
  const named = /\bserveur\s+([A-Za-z]+[-_]?[A-Za-z]*\d+|[A-Za-z]+-[A-Za-z0-9]+)\b/i.exec(original);
  return named ? named[1] : undefined;
}

function driveHints(original: string): { letter?: string; unc?: string } {
  const unc = /(\\\\[^\s"'<>|]+)/.exec(original)?.[1];
  const letter = /\b([D-Zd-z]):/.exec(original)?.[1]?.toUpperCase();
  return { ...(letter ? { letter } : {}), ...(unc ? { unc } : {}) };
}

function matchInstallApp(text: string): string | undefined {
  for (const app of INSTALL_CATALOG) {
    if ((app.keywords ?? []).some((k) => new RegExp(`(^|[^a-z0-9+])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+])`).test(text))) return app.key;
  }
  return undefined;
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

  // Hors de portée : on le dit honnêtement au lieu de faire semblant (voir conversation.ts).
  if (INFRASTRUCTURE.test(text)) add({ kind: 'human_only', topic: 'infrastructure' });
  else if (FLEET.test(text)) add({ kind: 'human_only', topic: 'fleet' });
  else if (ACCOUNTS.test(text) && !/\bcomment\b/.test(text)) add({ kind: 'human_only', topic: 'accounts' });

  if (REPAIR.test(text) && !OFFICE.test(text)) add({ kind: 'repair' });

  if (SERVER_WORD.test(text) && SERVER_PROBLEM.test(text) && !INFRASTRUCTURE.test(text)) add({ kind: 'server', host: explicitHost(original) });
  if (MAPDRIVE.test(text)) add({ kind: 'mapdrive', ...driveHints(original) });
  if (INSTALL.test(text)) add({ kind: 'install', app: matchInstallApp(text) });
  if (TRAINING.test(text) && !/\b(excel|word|outlook)\b.*\b(ne|plante|bloque|erreur)\b/.test(text)) add({ kind: 'training', topic: original });
  if (SCREENSHOT.test(text)) add({ kind: 'chat' });
  // « Apprends-moi Excel » est une demande de formation, pas un problème Office ni une simple question.
  if (out.some((i) => i.kind === 'training') && !OFFICE_PROBLEM.test(text)) return out.filter((i) => i.kind === 'training');

  // Une question de définition (« c'est quoi un pare-feu ? ») est une question d'usage, pas une demande d'analyse.
  if (/^\s*(c'est quoi|qu'est-ce|qu'est ce|que veut dire|a quoi sert|ca veut dire)/.test(text) && out.length === 0) {
    add({ kind: 'chat' });
    return out;
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
  // « Accès au serveur » et « lecteur réseau » parlent de réseau sans être une panne d'Internet : on ne propose pas les deux.
  if (out.some((i) => i.kind === 'server' || i.kind === 'mapdrive' || (i.kind === 'skill' && (i as { skillId: string }).skillId === 'lan-map'))) {
    for (let i = out.length - 1; i >= 0; i--) if (out[i]!.kind === 'skill' && (out[i] as { skillId: string }).skillId === 'network') out.splice(i, 1);
  }
  return out;
}
