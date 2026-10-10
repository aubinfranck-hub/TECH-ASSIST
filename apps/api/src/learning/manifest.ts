/**
 * CATALOGUE FERMÉ des opérations qu'une procédure apprise peut utiliser.
 *
 * ⚠ Ce fichier est IDENTIQUE dans apps/agent/src/procedures/manifest.ts et apps/api/src/learning/manifest.ts
 * (un test de conformité compare les deux). Il ne contient ni import ni accès au système : seulement des
 * données et des fonctions pures. Le serveur s'en sert pour dire à l'IA ce qui est permis et pour refuser tôt ;
 * l'agent s'en sert pour TOUT revalider avant d'exécuter (il ne fait jamais confiance au serveur ni à l'IA).
 *
 * Principe de sûreté : une procédure apprise n'est JAMAIS une commande. C'est une liste d'étapes qui désignent
 * des opérations de ce catalogue, avec des paramètres tous validés (noms, listes fermées, bornes). Ce que l'agent
 * sait faire est donc exactement ce que ce catalogue permet, quelle que soit l'IA qui a proposé la procédure.
 */

/** À augmenter quand une opération ou une règle change : le serveur n'envoie que des procédures de cette version. */
export const CATALOG_VERSION = 1;

export type FactType = 'boolean' | 'number' | 'string';
export type FactValue = boolean | number | string;
export type Facts = Record<string, FactValue>;
export type ArgValue = string | number;
export type Args = Record<string, ArgValue>;

export type ArgSpec =
  | { type: 'serviceName' }
  | { type: 'processName' }
  | { type: 'label' }
  | { type: 'host' }
  | { type: 'drive' }
  | { type: 'enum'; values: readonly string[] }
  | { type: 'int'; min: number; max: number }
  | { type: 'intIn'; values: readonly number[] };

export interface Primitive {
  role: 'observe' | 'act';
  /** Description donnée à l'IA (en français). */
  doc: string;
  args: Record<string, { spec: ArgSpec; optional?: boolean }>;
  /** Observation : les constats que l'opération renvoie (seuls ceux-là peuvent servir dans une attente). */
  facts?: Record<string, FactType>;
}

export const PRIMITIVES = {
  // --- Lecture seule : constater l'état de l'ordinateur ---
  service_status: {
    role: 'observe',
    doc: "État d'un service Windows (par son nom court, ex. Spooler, Dnscache, wuauserv).",
    args: { name: { spec: { type: 'serviceName' } } },
    facts: { exists: 'boolean', status: 'string', startType: 'string' },
  },
  process_info: {
    role: 'observe',
    doc: "Un programme est-il en cours d'exécution ? (nom du processus sans .exe, ex. OUTLOOK, Teams, chrome).",
    args: { name: { spec: { type: 'processName' } } },
    facts: { running: 'boolean', count: 'number', memoryMB: 'number' },
  },
  event_errors: {
    role: 'observe',
    doc: "Nombre d'erreurs récentes dans le journal d'événements Windows, éventuellement limité à celles qui mentionnent un mot (source).",
    args: {
      log: { spec: { type: 'enum', values: ['Application', 'System'] } },
      hours: { spec: { type: 'int', min: 1, max: 168 } },
      source: { spec: { type: 'label' }, optional: true },
    },
    facts: { errors: 'number' },
  },
  disk_free: {
    role: 'observe',
    doc: "Espace libre d'un disque (lettre, ex. C).",
    args: { drive: { spec: { type: 'drive' } } },
    facts: { freeGB: 'number', freePercent: 'number' },
  },
  net_ping: {
    role: 'observe',
    doc: "Un ordinateur ou un site répond-il au test de connexion (ping) ? Hôtes permis : adresses privées, noms du réseau local, et quelques sites connus (google.com, microsoft.com, 8.8.8.8, 1.1.1.1, login.microsoftonline.com, outlook.office365.com, teams.microsoft.com, time.windows.com).",
    args: { host: { spec: { type: 'host' } } },
    facts: { reachable: 'boolean' },
  },
  net_port: {
    role: 'observe',
    doc: 'Un port réseau est-il ouvert sur un ordinateur ? Mêmes hôtes que net_ping. Ports permis : 25, 53, 80, 110, 143, 443, 445, 465, 587, 993, 995, 1433, 3389, 8080.',
    args: { host: { spec: { type: 'host' } }, port: { spec: { type: 'intIn', values: [25, 53, 80, 110, 143, 443, 445, 465, 587, 993, 995, 1433, 3389, 8080] } } },
    facts: { open: 'boolean' },
  },
  dns_resolve: {
    role: 'observe',
    doc: "Un nom de site est-il traduit en adresse par le DNS de l'ordinateur ? Mêmes noms que net_ping.",
    args: { name: { spec: { type: 'host' } } },
    facts: { resolved: 'boolean' },
  },
  program_installed: {
    role: 'observe',
    doc: "Un logiciel est-il installé ? (une partie de son nom suffit, ex. Outlook, Chrome, Adobe)",
    args: { name: { spec: { type: 'label' } } },
    facts: { installed: 'boolean', version: 'string' },
  },
  setting_read: {
    role: 'observe',
    doc: "Lit un réglage Windows : fast_startup (démarrage rapide) ou proxy (serveur proxy). Constat : enabled.",
    args: { key: { spec: { type: 'enum', values: ['fast_startup', 'proxy'] } } },
    facts: { enabled: 'boolean' },
  },

  // --- Modifications : toutes soumises à l'accord du client ---
  service_start: {
    role: 'act',
    doc: 'Démarre un service Windows arrêté. Impossible sur les services réservés à la sécurité ou à l\'accès à distance.',
    args: { name: { spec: { type: 'serviceName' } } },
  },
  service_restart: {
    role: 'act',
    doc: 'Arrête puis relance un service Windows. Impossible sur les services du système, de la sécurité et du pare-feu.',
    args: { name: { spec: { type: 'serviceName' } } },
  },
  service_set_startup: {
    role: 'act',
    doc: "Règle le mode de démarrage d'un service : Automatic ou Manual (jamais Disabled). Impossible sur les services du système et de la sécurité.",
    args: { name: { spec: { type: 'serviceName' } }, mode: { spec: { type: 'enum', values: ['Automatic', 'Manual'] } } },
  },
  process_stop: {
    role: 'act',
    doc: "Ferme un programme ouvert ou bloqué (nom du processus sans .exe). Le travail non enregistré dans ce programme est perdu. Impossible sur les processus du système et de la sécurité.",
    args: { name: { spec: { type: 'processName' } } },
  },
  explorer_restart: {
    role: 'act',
    doc: "Relance l'explorateur Windows (barre des tâches, bureau, fenêtres de dossiers) : règle beaucoup de blocages d'affichage.",
    args: {},
  },
  explorer_caches: {
    role: 'act',
    doc: "Vide les caches de miniatures et d'icônes de Windows (icônes blanches ou fausses, miniatures qui ne s'affichent pas). Relance l'explorateur.",
    args: {},
  },
  net_reset: {
    role: 'act',
    doc: 'Réinitialise une partie du réseau : flush_dns (cache DNS), renew_ip (nouvelle adresse du routeur), winsock (pile réseau ; demande un redémarrage).',
    args: { what: { spec: { type: 'enum', values: ['flush_dns', 'renew_ip', 'winsock'] } } },
  },
  setting_set: {
    role: 'act',
    doc: 'Change un réglage Windows : fast_startup on|off (démarrage rapide) ou proxy off (désactive le serveur proxy). Rien d\'autre.',
    args: { key: { spec: { type: 'enum', values: ['fast_startup', 'proxy'] } }, value: { spec: { type: 'enum', values: ['on', 'off'] } } },
  },
} as const satisfies Record<string, Primitive>;

export type ToolId = keyof typeof PRIMITIVES;
export const TOOL_IDS = Object.keys(PRIMITIVES) as ToolId[];

export function isTool(value: unknown): value is ToolId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRIMITIVES, value);
}

// ---------------------------------------------------------------------------
// Listes de protection

/** Services qu'aucune procédure ne peut redémarrer ni reconfigurer : système, sécurité, pare-feu. */
export const PROTECTED_SERVICES: readonly string[] = [
  'rpcss', 'rpceptmapper', 'dcomlaunch', 'lsm', 'samss', 'eventlog', 'mpssvc', 'bfe', 'windefend', 'wdnissvc', 'wdfilter', 'sense',
  'securityhealthservice', 'wscsvc', 'cryptsvc', 'trustedinstaller', 'winmgmt', 'schedule', 'profsvc', 'usermanager', 'power', 'plugplay',
  'gpsvc', 'netlogon', 'kdc', 'lsass', 'sppsvc', 'tiledatamodelsvc', 'brokerinfrastructure', 'coremessagingregistrar', 'systemeventsbroker',
];

/** Services que l'agent ne démarre ni ne réactive jamais : ouvrir l'accès à distance ou le partage expose l'ordinateur. */
export const NEVER_ENABLE_SERVICES: readonly string[] = [
  'remoteregistry', 'tlntsvr', 'snmp', 'remoteaccess', 'ssdpsrv', 'upnphost', 'winrm', 'termservice', 'sshd', 'ftpsvc', 'w3svc', 'sessionenv',
  'umrdpservice', 'lanmanserver', 'webclient', 'rpclocator', 'msftpsvc', 'simptcp', 'fax',
];

/** Processus qu'aucune procédure ne peut fermer : système, sécurité, et les programmes qui font tourner l'agent lui-même. */
export const PROTECTED_PROCESSES: readonly string[] = [
  'system', 'idle', 'registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'lsm', 'svchost', 'dwm', 'fontdrvhost',
  'msmpeng', 'nissrv', 'securityhealthservice', 'securityhealthsystray', 'sihost', 'explorer', 'taskhostw', 'runtimebroker', 'audiodg',
  'powershell', 'pwsh', 'powershell_ise', 'cmd', 'conhost', 'wmiprvse', 'spoolsv', 'searchhost', 'startmenuexperiencehost',
];

/** Hôtes publics permis pour les tests réseau ; les autres hôtes permis sont locaux (voir isAllowedHost). */
export const PUBLIC_HOSTS: readonly string[] = [
  'google.com', 'www.google.com', 'microsoft.com', 'www.microsoft.com', 'login.microsoftonline.com', 'outlook.office365.com', 'outlook.office.com',
  'teams.microsoft.com', 'onedrive.live.com', 'time.windows.com', 'download.windowsupdate.com', 'www.msftconnecttest.com', '8.8.8.8', '1.1.1.1', '9.9.9.9',
];

const SERVICE_NAME = /^[A-Za-z0-9_.-]{1,40}$/;
const PROCESS_NAME = /^[A-Za-z0-9_.-]{1,40}$/;
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} ._+-]{1,59}$/u;
const SINGLE_LABEL_HOST = /^[A-Za-z][A-Za-z0-9-]{0,62}$/;
const LAN_HOST = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}(\.[A-Za-z0-9-]{1,63})*\.(local|lan|home|internal|corp)$/i;

/** Hôte permis pour un test réseau : site connu, adresse privée, nom du réseau local. Jamais une adresse publique quelconque. */
export function isAllowedHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (PUBLIC_HOSTS.includes(lower)) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ip) {
    const parts = ip.slice(1).map(Number);
    if (parts.some((n) => n > 255)) return false;
    const [a, b] = parts as [number, number, number, number];
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return SINGLE_LABEL_HOST.test(host) || LAN_HOST.test(host);
}

// ---------------------------------------------------------------------------
// Validation des paramètres

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error });

function checkArg(tool: string, name: string, spec: ArgSpec, raw: unknown): Checked<ArgValue> {
  const where = `${tool}.${name}`;
  switch (spec.type) {
    case 'serviceName':
      if (typeof raw !== 'string' || !SERVICE_NAME.test(raw)) return bad(`${where} : nom de service invalide`);
      return { ok: true, value: raw };
    case 'processName': {
      if (typeof raw !== 'string') return bad(`${where} : nom de processus invalide`);
      const value = raw.replace(/\.exe$/i, '');
      if (!PROCESS_NAME.test(value)) return bad(`${where} : nom de processus invalide`);
      return { ok: true, value };
    }
    case 'label':
      if (typeof raw !== 'string' || !LABEL.test(raw.trim())) return bad(`${where} : texte invalide (lettres, chiffres, espaces, . _ + - ; 2 à 60 signes)`);
      return { ok: true, value: raw.trim() };
    case 'host':
      if (typeof raw !== 'string' || !isAllowedHost(raw.trim())) return bad(`${where} : hôte non permis`);
      return { ok: true, value: raw.trim() };
    case 'drive':
      if (typeof raw !== 'string' || !/^[A-Za-z]$/.test(raw.replace(/:$/, ''))) return bad(`${where} : lettre de disque invalide`);
      return { ok: true, value: raw.replace(/:$/, '').toUpperCase() };
    case 'enum':
      if (typeof raw !== 'string' || !spec.values.includes(raw)) return bad(`${where} : valeur hors liste (${spec.values.join(', ')})`);
      return { ok: true, value: raw };
    case 'int':
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < spec.min || raw > spec.max) return bad(`${where} : entier de ${spec.min} à ${spec.max} attendu`);
      return { ok: true, value: raw };
    case 'intIn':
      if (typeof raw !== 'number' || !spec.values.includes(raw)) return bad(`${where} : valeur hors liste (${spec.values.join(', ')})`);
      return { ok: true, value: raw };
  }
}

/**
 * Valide et normalise les paramètres d'une opération : aucun paramètre inconnu, aucun manquant, chacun conforme à sa forme,
 * et les règles de protection propres à l'opération (services et processus protégés, réglages permis).
 */
export function validateArgs(tool: string, raw: unknown): Checked<Args> {
  if (!isTool(tool)) return bad(`Opération inconnue : ${String(tool).slice(0, 40)}`);
  if (raw === undefined) raw = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return bad(`${tool} : paramètres invalides`);
  const input = raw as Record<string, unknown>;
  const primitive: Primitive = PRIMITIVES[tool];
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(primitive.args, key)) return bad(`${tool} : paramètre inconnu « ${key.slice(0, 30)} »`);
  }
  const out: Args = {};
  for (const [name, def] of Object.entries(primitive.args)) {
    const given = Object.prototype.hasOwnProperty.call(input, name) ? input[name] : undefined;
    if (given === undefined || given === null) {
      if (def.optional) continue;
      return bad(`${tool} : paramètre « ${name} » manquant`);
    }
    const checked = checkArg(tool, name, def.spec, given);
    if (!checked.ok) return checked;
    out[name] = checked.value;
  }

  const lowerName = typeof out.name === 'string' ? out.name.toLowerCase() : '';
  if (tool === 'service_start' && NEVER_ENABLE_SERVICES.includes(lowerName)) return bad(`${tool} : le service « ${out.name} » ne peut pas être démarré par l'agent`);
  if ((tool === 'service_restart' || tool === 'service_set_startup') && (PROTECTED_SERVICES.includes(lowerName) || NEVER_ENABLE_SERVICES.includes(lowerName))) {
    return bad(`${tool} : le service « ${out.name} » est protégé`);
  }
  if (tool === 'process_stop' && (PROTECTED_PROCESSES.includes(lowerName) || /^tech[-_ ]?assist/i.test(lowerName))) return bad(`${tool} : le processus « ${out.name} » est protégé`);
  if (tool === 'setting_set' && out.key === 'proxy' && out.value !== 'off') return bad('setting_set : le proxy ne peut qu\'être désactivé');
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Ce que l'opération représente pour le client et pour la sûreté

export interface Traits {
  /** Demande les droits administrateur. */
  admin: boolean;
  /** Difficile à défaire : un point de restauration est créé d'abord. */
  sensitive: boolean;
  /** Ne prend effet qu'après un redémarrage. */
  reboot: boolean;
}

export function traitsOf(tool: ToolId, args: Args): Traits {
  switch (tool) {
    case 'service_start':
    case 'service_restart':
    case 'service_set_startup':
      return { admin: true, sensitive: false, reboot: false };
    case 'net_reset':
      return { admin: true, sensitive: args.what === 'winsock', reboot: args.what === 'winsock' };
    case 'setting_set':
      return { admin: args.key === 'fast_startup', sensitive: false, reboot: false };
    default:
      return { admin: false, sensitive: false, reboot: false };
  }
}

const MODE_FR: Record<string, string> = { Automatic: 'automatique', Manual: 'manuel' };

/** Titre court montré au client (les paramètres sont déjà validés : jamais de texte libre de l'IA ici). */
export function actTitle(tool: ToolId, a: Args): string {
  switch (tool) {
    case 'service_start':
      return `Démarrer le service « ${a.name} »`;
    case 'service_restart':
      return `Redémarrer le service « ${a.name} »`;
    case 'service_set_startup':
      return `Régler le démarrage du service « ${a.name} » sur ${MODE_FR[String(a.mode)] ?? a.mode}`;
    case 'process_stop':
      return `Fermer le programme « ${a.name} »`;
    case 'explorer_restart':
      return "Relancer l'explorateur Windows";
    case 'explorer_caches':
      return 'Vider les caches des miniatures et des icônes';
    case 'net_reset':
      return a.what === 'flush_dns' ? 'Vider le cache DNS' : a.what === 'renew_ip' ? "Renouveler l'adresse réseau (DHCP)" : 'Réinitialiser la pile réseau (Winsock)';
    case 'setting_set':
      return a.key === 'proxy' ? 'Désactiver le serveur proxy de Windows' : a.value === 'off' ? 'Désactiver le démarrage rapide de Windows' : 'Activer le démarrage rapide de Windows';
    default:
      return String(tool);
  }
}

/** Explication de ce que l'opération change, en mots simples (texte fixe, jamais écrit par l'IA). */
export function actExplanation(tool: ToolId, a: Args): string {
  switch (tool) {
    case 'service_start':
      return `Je démarre le service Windows « ${a.name} », qui est arrêté. Rien n'est supprimé.`;
    case 'service_restart':
      return `J'arrête puis je relance le service Windows « ${a.name} ». Ce qui l'utilise peut se couper un instant.`;
    case 'service_set_startup':
      return `Je règle le service « ${a.name} » pour qu'il démarre de façon ${MODE_FR[String(a.mode)] ?? a.mode} avec Windows. Je ne désactive jamais un service.`;
    case 'process_stop':
      return `Je ferme le programme « ${a.name} » s'il est ouvert ou bloqué. Ce qui n'est pas enregistré dans ce programme sera perdu : enregistrez votre travail avant.`;
    case 'explorer_restart':
      return "La barre des tâches et le bureau disparaissent une seconde, puis reviennent. Les fenêtres de dossiers ouvertes se ferment ; vos fichiers ne sont pas touchés.";
    case 'explorer_caches':
      return "Je supprime les fichiers temporaires qui servent à afficher les miniatures et les icônes (Windows les recrée tout seul), puis je relance l'explorateur. Vos fichiers ne sont pas touchés.";
    case 'net_reset':
      return a.what === 'flush_dns'
        ? 'Je vide la mémoire des noms de sites que Windows a retenus. Elle se reconstruit toute seule.'
        : a.what === 'renew_ip'
          ? "Je demande une nouvelle adresse à votre routeur. La connexion Internet se coupe quelques secondes."
          : "Je réinitialise la partie de Windows qui gère les connexions réseau. Un redémarrage est nécessaire ensuite. Un point de restauration est créé avant.";
    case 'setting_set':
      return a.key === 'proxy'
        ? "Je désactive le serveur proxy configuré dans Windows : le navigateur se connecte directement. Vous pouvez le réactiver dans les Paramètres."
        : a.value === 'off'
          ? "Le démarrage rapide garde un état partiel de Windows entre deux arrêts : le désactiver règle beaucoup de blocages au réveil ou au démarrage. Le démarrage peut devenir un peu plus long."
          : 'Je réactive le démarrage rapide de Windows (démarrage plus court).';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Procédure apprise : forme et validation

export type Op = 'eq' | 'ne' | 'lt' | 'gt' | 'contains';
export interface Expect {
  fact: string;
  op: Op;
  value: FactValue;
}

export interface Check {
  id: string;
  tool: ToolId;
  args: Args;
  /** Ce qu'on attend d'un ordinateur en bon état. Si ce n'est pas vérifié, le problème est présent. */
  expect: Expect;
  /** Phrase montrée au client quand l'attente n'est pas vérifiée. */
  problem: string;
}

export interface Fix {
  id: string;
  tool: ToolId;
  args: Args;
  /** Pourquoi cette étape (une phrase, pour le client). */
  why: string;
  /** N'est proposée que si l'une de ces vérifications a échoué ; absent : proposée dès qu'un problème est constaté. */
  onlyIf?: string[];
}

export interface Procedure {
  schemaVersion: 1;
  title: string;
  summary: string;
  /** Mots-clés (minuscules, sans accent) qui servent à retrouver cette procédure. */
  keywords: string[];
  verifyQuestion: string;
  checks: Check[];
  fixes: Fix[];
  /** Gestes que le client fait lui-même (l'agent ne les exécute pas). */
  advice: string[];
}

export const LIMITS = { checks: 6, fixes: 6, steps: 10, advice: 5, keywords: 12 } as const;

/** Texte affichable : pas de caractères de contrôle ni de balises, espaces réduits, borné. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Mot-clé : minuscules, sans accent, lettres et chiffres seulement. */
export function normalizeKeyword(value: unknown): string | null {
  const k = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return k.length >= 3 && k.length <= 24 ? k : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkExpect(tool: ToolId, raw: unknown): Checked<Expect> {
  if (!isRecord(raw)) return bad(`${tool} : attente manquante`);
  const facts: Record<string, FactType> = PRIMITIVES[tool].role === 'observe' ? { ...(PRIMITIVES[tool] as Primitive).facts } : {};
  const fact = raw.fact;
  if (typeof fact !== 'string' || !Object.prototype.hasOwnProperty.call(facts, fact)) return bad(`${tool} : constat inconnu « ${String(fact).slice(0, 30)} » (permis : ${Object.keys(facts).join(', ')})`);
  const type = facts[fact]!;
  const op = raw.op;
  if (op !== 'eq' && op !== 'ne' && op !== 'lt' && op !== 'gt' && op !== 'contains') return bad(`${tool} : comparaison invalide`);
  const value = raw.value;
  if (type === 'boolean' && (typeof value !== 'boolean' || (op !== 'eq' && op !== 'ne'))) return bad(`${tool}.${fact} : vrai ou faux attendu (eq ou ne)`);
  if (type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || op === 'contains')) return bad(`${tool}.${fact} : nombre attendu (eq, ne, lt, gt)`);
  if (type === 'string' && (typeof value !== 'string' || value.length > 40 || (op !== 'eq' && op !== 'ne' && op !== 'contains'))) return bad(`${tool}.${fact} : texte court attendu (eq, ne, contains)`);
  return { ok: true, value: { fact, op, value: type === 'string' ? String(value).toLowerCase() : (value as FactValue) } };
}

/** Vrai si l'attente est vérifiée par les constats. Un constat absent ne vérifie jamais l'attente (on ne devine pas). */
export function expectationMet(facts: Facts, e: Expect): boolean {
  if (!Object.prototype.hasOwnProperty.call(facts, e.fact)) return false;
  const actual = facts[e.fact]!;
  const a = typeof actual === 'string' ? actual.toLowerCase() : actual;
  switch (e.op) {
    case 'eq':
      return a === e.value;
    case 'ne':
      return a !== e.value;
    case 'lt':
      return typeof a === 'number' && typeof e.value === 'number' && a < e.value;
    case 'gt':
      return typeof a === 'number' && typeof e.value === 'number' && a > e.value;
    case 'contains':
      return typeof a === 'string' && typeof e.value === 'string' && a.includes(e.value);
  }
}

/**
 * Valide une procédure venue d'ailleurs (IA, serveur, mémoire) et la renvoie sous forme normalisée.
 * Tout ce qui n'est pas explicitement permis est refusé.
 */
export function validateProcedure(raw: unknown): Checked<Procedure> {
  if (!isRecord(raw)) return bad('La procédure doit être un objet');
  const allowedTop = new Set(['schemaVersion', 'title', 'summary', 'keywords', 'verifyQuestion', 'checks', 'fixes', 'advice']);
  for (const key of Object.keys(raw)) if (!allowedTop.has(key)) return bad(`Champ inconnu : ${key.slice(0, 30)}`);
  if (raw.schemaVersion !== 1) return bad('schemaVersion doit valoir 1');

  const title = cleanText(raw.title, 80);
  const summary = cleanText(raw.summary, 300);
  const verifyQuestion = cleanText(raw.verifyQuestion, 140);
  if (title.length < 4) return bad('title manquant');
  if (summary.length < 8) return bad('summary manquant');
  if (verifyQuestion.length < 8) return bad('verifyQuestion manquante');

  if (!Array.isArray(raw.keywords)) return bad('keywords doit être une liste');
  const keywords = [...new Set(raw.keywords.map(normalizeKeyword).filter((k): k is string => k !== null))].slice(0, LIMITS.keywords);
  if (keywords.length < 2) return bad('Au moins 2 mots-clés (3 à 24 lettres) sont nécessaires');

  const rawChecks = raw.checks === undefined ? [] : raw.checks;
  const rawFixes = raw.fixes === undefined ? [] : raw.fixes;
  const rawAdvice = raw.advice === undefined ? [] : raw.advice;
  if (!Array.isArray(rawChecks) || !Array.isArray(rawFixes) || !Array.isArray(rawAdvice)) return bad('checks, fixes et advice doivent être des listes');
  if (rawChecks.length > LIMITS.checks || rawFixes.length > LIMITS.fixes || rawChecks.length + rawFixes.length > LIMITS.steps || rawAdvice.length > LIMITS.advice) {
    return bad('Procédure trop longue');
  }

  const ids = new Set<string>();
  const checks: Check[] = [];
  for (const item of rawChecks) {
    if (!isRecord(item)) return bad('Vérification invalide');
    const id = item.id;
    if (typeof id !== 'string' || !/^c[0-9]{1,2}$/.test(id) || ids.has(id)) return bad('Identifiant de vérification invalide ou répété (c1, c2…)');
    ids.add(id);
    if (!isTool(item.tool) || PRIMITIVES[item.tool].role !== 'observe') return bad(`${id} : une vérification doit utiliser une opération de lecture`);
    const args = validateArgs(item.tool, item.args);
    if (!args.ok) return bad(`${id} : ${args.error}`);
    const expect = checkExpect(item.tool, item.expect);
    if (!expect.ok) return bad(`${id} : ${expect.error}`);
    const problem = cleanText(item.problem, 160);
    if (problem.length < 5) return bad(`${id} : problem manquant`);
    checks.push({ id, tool: item.tool, args: args.value, expect: expect.value, problem });
  }

  const fixes: Fix[] = [];
  for (const item of rawFixes) {
    if (!isRecord(item)) return bad('Correction invalide');
    const id = item.id;
    if (typeof id !== 'string' || !/^f[0-9]{1,2}$/.test(id) || ids.has(id)) return bad('Identifiant de correction invalide ou répété (f1, f2…)');
    ids.add(id);
    if (!isTool(item.tool) || PRIMITIVES[item.tool].role !== 'act') return bad(`${id} : une correction doit utiliser une opération de modification`);
    const args = validateArgs(item.tool, item.args);
    if (!args.ok) return bad(`${id} : ${args.error}`);
    const why = cleanText(item.why, 200);
    if (why.length < 5) return bad(`${id} : why manquant`);
    let onlyIf: string[] | undefined;
    if (item.onlyIf !== undefined) {
      if (!Array.isArray(item.onlyIf) || item.onlyIf.length === 0 || item.onlyIf.length > LIMITS.checks) return bad(`${id} : onlyIf invalide`);
      for (const ref of item.onlyIf) if (typeof ref !== 'string' || !checks.some((c) => c.id === ref)) return bad(`${id} : onlyIf désigne une vérification inconnue`);
      onlyIf = item.onlyIf as string[];
    }
    fixes.push({ id, tool: item.tool, args: args.value, why, ...(onlyIf ? { onlyIf } : {}) });
  }

  const advice = rawAdvice.map((a) => cleanText(a, 300)).filter((a) => a.length >= 5);
  if (fixes.length === 0 && advice.length === 0) return bad('La procédure ne propose ni correction ni conseil');

  return { ok: true, value: { schemaVersion: 1, title, summary, keywords, verifyQuestion, checks, fixes, advice } };
}

/** Description du catalogue pour l'IA (le serveur la place dans sa consigne). */
export function describeCatalog(): string {
  const lines: string[] = [];
  for (const role of ['observe', 'act'] as const) {
    lines.push(role === 'observe' ? 'OPÉRATIONS DE LECTURE (pour "checks") :' : 'OPÉRATIONS DE MODIFICATION (pour "fixes") :');
    for (const tool of TOOL_IDS) {
      const p: Primitive = PRIMITIVES[tool];
      if (p.role !== role) continue;
      const args = Object.entries(p.args).map(([name, def]) => `${name}${def.optional ? '?' : ''}: ${describeSpec(def.spec)}`);
      const facts = p.facts ? ` Constats : ${Object.entries(p.facts).map(([k, t]) => `${k} (${t})`).join(', ')}.` : '';
      lines.push(`- ${tool}(${args.join(', ')}) — ${p.doc}${facts}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function describeSpec(spec: ArgSpec): string {
  switch (spec.type) {
    case 'serviceName':
      return 'nom court de service';
    case 'processName':
      return 'nom de processus sans .exe';
    case 'label':
      return 'texte court';
    case 'host':
      return 'hôte permis';
    case 'drive':
      return 'lettre de disque';
    case 'enum':
      return spec.values.map((v) => `"${v}"`).join(' | ');
    case 'int':
      return `entier ${spec.min}..${spec.max}`;
    case 'intIn':
      return spec.values.join(' | ');
  }
}
