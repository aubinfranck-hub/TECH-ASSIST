import { runSkill, type Outcome } from './agent.js';
import type { Assistant, ChatTurn } from './assistant.js';
import { CONSENT_NO, CONSENT_TEXT, CONSENT_YES, withStandingConsent } from './consent.js';
import { ensureHuman, HUMAN_REQUEST_TEXT } from './humanAccess.js';
import type { Knowledge, LearnResult } from './knowledge.js';
import { compileProcedure } from './procedures/compile.js';
import { repairMyPc } from './repairPc.js';
import { routeIntent, type HumanOnlyTopic, type Intent } from './router.js';
import { SKILL_MENU, resolveSkill } from './skills/index.js';
import { INSTALL_CATALOG, installSkill } from './skills/install.js';
import { DRIVE_LETTER, UNC_PATH, mapDriveSkill } from './skills/mapDrive.js';
import { SERVER_HOST, serverCheckSkill } from './skills/serverCheck.js';
import { serverHealthSkill } from './skills/serverHealth.js';
import { runTraining } from './training.js';
import { findPrograms, listInstalledPrograms, planUninstall, uninstallProgramSkill, type InstalledProgram } from './skills/uninstall.js';
import type { AgentEvent, CommandRunner, ConversationUi, Reporter, Skill } from './types.js';

export interface ConversationDeps {
  runner: CommandRunner;
  ui: ConversationUi;
  reporter: Reporter;
  /** Assistant en ligne pour les questions d'usage ; absent : l'agent propose un technicien. */
  assistant?: Assistant;
  /** Pour les tests : remplace la résolution des compétences. */
  resolve?: (id: string) => Skill | undefined;
  /** Dossiers de désinstallateurs autorisés (tests). */
  roots?: string[];
  /** Nom de l'ordinateur, imprimé en tête des rapports. */
  machine?: string;
  /** Rattachement à une entreprise ; absent si le client n'est pas connecté à son compte. */
  /** Portée du forfait payé : diagnostic (lecture seule), fix (un problème précis), full (tout). Absent = tout. */
  scope?: 'diagnostic' | 'fix' | 'full';
  /**
   * Mode guidé pour le grand public : un seul accord au début couvre les réparations (plus de « autoriser ? » à chaque étape),
   * une demande floue lance l'analyse complète au lieu d'un menu, et plusieurs pistes sont traitées à la suite sans question.
   */
  autonomous?: boolean;
  /** false : l'agent tourne sans droits administrateur (compte standard, ou fenêtre Windows refusée). */
  isAdmin?: boolean;
  /** Relance l'agent avec la demande d'identifiants de Windows ; true = une nouvelle instance prend le relais (celle-ci doit s'arrêter). */
  requestAdmin?: () => Promise<boolean>;
  company?: { join(code: string, deviceName: string): Promise<{ ok: true; companyName: string } | { ok: false; error: string }> };
  /**
   * Mémoire de Tech Assist pour les cas que le routeur ne reconnaît pas : procédure déjà apprise, sinon plan composé par l'IA
   * puis mémorisé. Absent (hors ligne, pas de session) : l'agent se comporte comme avant.
   */
  knowledge?: Knowledge;
}

export interface ConversationResult {
  /** Une nouvelle instance avec droits administrateur a pris le relais. */
  relaunched?: true;
  turns: number;
  /** Un technicien a été demandé (par l'agent ou par le client). */
  handedOver: boolean;
  /** true : l'agent a voulu passer la main mais le serveur n'a pas enregistré la demande (aucun technicien n'a été prévenu). */
  escalationFailed?: boolean;
  outcomes: Outcome[];
}

const GREETING =
  "Bonjour, je suis AI PC, votre technicien informatique. Dites-moi en une phrase ce que vous voulez — par exemple « mon ordinateur est lent » (je l'analyse et je le répare), « je n'ai pas Internet », « mon imprimante ne marche pas », « je n'accède pas au serveur », « je pense avoir un virus », « Outlook plante », « Teams ne se connecte pas », « OneDrive ne se synchronise plus », « Word dit produit non activé », « installe VLC », « je veux désinstaller Skype » — ou « apprends-moi Excel » pour une formation, ou posez-moi une question sur Office.";

/** Compte standard (ou fenêtre Windows refusée) : on dit simplement ce qui est possible, sans jargon. */
export const NO_ADMIN_TEXT =
  "Windows ne m'a pas donné les droits d'administrateur (ce compte est un compte « standard », ou la fenêtre de Windows a été refusée). Je peux quand même analyser votre PC et corriger ce qui est à votre portée (nettoyage, démarrage, Outlook, Teams…). Pour le reste, il faut le mot de passe de l'administrateur de ce PC (souvent la personne qui l'a installé). Si vous ne l'avez pas, ce n'est pas grave : continuez sans, et un technicien pourra faire le reste avec vous.";

/** Ce que l'agent ne fait pas : dit franchement, puis un technicien. */
const HUMAN_ONLY_TEXT: Record<HumanOnlyTopic, string> = {
  infrastructure:
    "Les routeurs, commutateurs, pare-feu d'entreprise, VPN, serveurs Windows et le domaine (Active Directory, stratégies de groupe) sont hors de ce que je fais seul : ils demandent des accès administrateur à l'infrastructure et une validation humaine. Un technicien peut s'en occuper. Je peux, de mon côté, vérifier ce PC (réseau, accès à un serveur) : dites-le-moi.",
  fleet:
    "Je m'occupe de l'ordinateur sur lequel je suis installé. La vue de plusieurs ordinateurs d'une entreprise (« 42 PC OK, 5 à surveiller ») et leur traitement en série ne sont pas encore disponibles. Un technicien peut intervenir sur vos autres postes.",
  accounts:
    "Je ne touche jamais aux mots de passe, aux comptes utilisateurs, aux droits d'accès ni au bureau à distance : c'est trop sensible pour être fait automatiquement. Un technicien peut s'en occuper avec vous, de façon sécurisée.",
};

const EMERGENCY_ADVICE = [
  "Ce que vous décrivez ressemble à un rançongiciel (virus qui bloque vos fichiers). Je ne tente rien moi-même : cela pourrait aggraver la situation.",
  "En attendant le technicien : débranchez l'ordinateur d'Internet (câble ou Wi-Fi), ne payez aucune rançon, n'éteignez pas et ne supprimez rien.",
];

/** Formule de clôture seule : « non, mais j'ai aussi un souci avec Outlook » ne doit PAS fermer la conversation. */
const GOODBYE = /^\s*(non|non merci|merci|merci beaucoup|c'est tout|c est tout|termine|terminer|quitter|au revoir|stop|rien|ca ira|ça ira)\s*[.!]*\s*$/i;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Conversation avec le client : il écrit son problème, l'agent comprend, lance la bonne compétence
 * (avec son accord à chaque modification), répond aux questions d'usage via l'assistant, et passe la
 * main à un technicien quand il le faut ou quand le client le demande.
 */
export async function converse(deps: ConversationDeps): Promise<ConversationResult> {
  const { runner, reporter } = deps;
  let ui = deps.ui;
  const resolve = deps.resolve ?? resolveSkill;
  const history: ChatTurn[] = [];
  const outcomes: Outcome[] = [];
  let turns = 0;
  let handedOver = false;
  let privacyNoted = false;

  let escalationFailed = false;
  const log = async (event: Omit<AgentEvent, 'skill'>): Promise<boolean> => {
    try {
      await reporter.event({ ...event, skill: 'conversation', message: event.message === undefined ? undefined : truncate(event.message, 500) });
      return true;
    } catch (err) {
      console.error(`[journal] impossible d'enregistrer « ${event.type} » :`, err instanceof Error ? err.message : err);
      return false;
    }
  };

  const handOver = async (reason: string) => {
    // Offre « IA seule » : sans complément payé, personne n'est prévenu ; la demande reste notée et la conversation continue.
    const allowed = await ensureHuman(reporter, ui);
    if (!allowed) {
      await log({ type: 'escalated', message: reason });
      return;
    }
    handedOver = true;
    if (!(await log({ type: 'escalated', message: reason }))) escalationFailed = true;
    ui.info(escalationFailed ? "Je n'ai pas pu transmettre votre demande à un technicien." : "Je passe la main à un technicien, qui verra notre conversation et tout ce que j'ai constaté.");
  };

  const offerTechnician = async () => {
    const choice = await ui.choose('Voulez-vous qu\'un technicien prenne le relais ?', ['Oui, un technicien', 'Non merci']);
    if (choice === 0) await handOver('Le client demande un technicien');
  };

  ui.info(GREETING);
  if (deps.autonomous && deps.isAdmin === false) {
    ui.info(NO_ADMIN_TEXT);
    if (deps.requestAdmin) {
      const pick = await ui.choose("Que voulez-vous faire ?", ['Continuer sans (je fais ce que je peux)', "J'ai le mot de passe administrateur"]);
      if (pick === 1) {
        ui.info("Windows va vous demander l'identifiant et le mot de passe de l'administrateur. Une nouvelle fenêtre s'ouvre ensuite : je continue là-bas.");
        if (await deps.requestAdmin()) return { relaunched: true, turns: 0, handedOver: false, outcomes: [] };
        ui.info("Les droits n'ont pas été accordés : je continue sans.");
      }
    }
  }
  // Accord unique : sauf forfait « diagnostic » (rien n'est modifié), le client autorise une fois pour toute la session.
  if (deps.autonomous && deps.scope !== 'diagnostic') {
    ui.info(CONSENT_TEXT);
    const pick = await ui.choose('Êtes-vous d’accord ?', [CONSENT_YES, CONSENT_NO]);
    if (pick === 0) {
      ui = withStandingConsent(ui);
      await log({ type: 'action_approved', message: 'Accord unique du client pour la session (analyse et réparations)' });
    } else if (pick === 1) {
      ui.info("Pas de problème : je vous demanderai votre accord avant chaque modification.");
    }
  }
  let first = true;
  while (!handedOver) {
    const text = await ui.ask(first ? 'Que puis-je faire pour vous ?' : 'Autre chose ? (écrivez « non » pour terminer)');
    if (text === null || (!first && GOODBYE.test(text))) break;
    const message = text.trim();
    if (!message) continue;
    // Bouton « Parler à un technicien » sans technicien dans l'offre : la fenêtre l'écrit à la place du client.
    if (message === HUMAN_REQUEST_TEXT) {
      await handOver('Le client demande un technicien');
      continue;
    }
    if (first) ui.progress?.(3);
    first = false;
    turns += 1;
    await log({ type: 'user_request', message });

    let intents = routeIntent(message);

    if (intents.some((i) => i.kind === 'emergency')) {
      for (const line of EMERGENCY_ADVICE) ui.info(line);
      await handOver('Rançongiciel suspecté : intervention humaine immédiate');
      break;
    }

    // Plusieurs pistes (ex. « casque Bluetooth ») : le client tranche, on traite l'autre ensuite s'il le demande.
    if (intents.length > 1 && deps.autonomous) {
      // Pas de question au client : si ce sont toutes des compétences, on les traite à la suite ; sinon la première piste.
      if (intents.every((i) => i.kind === 'skill')) {
        for (const i of intents.slice(0, 3)) {
          const sk = resolve((i as { skillId: string }).skillId);
          if (sk && !handedOver) outcomes.push(await runAndNote(sk));
        }
        continue;
      }
      intents = [intents[0]!];
    }
    if (intents.length > 1) {
      const labels = intents.map(describe);
      const pick = await ui.choose('Je peux traiter plusieurs choses. Par laquelle commencer ?', labels);
      if (pick === null) continue;
      intents = [intents[pick]!];
    }
    const intent = intents[0];

    if (!intent) {
      // Cas inconnu du routeur : la mémoire d'abord (aucun appel d'IA si le cas a déjà été résolu), puis l'IA qui compose un plan.
      if (deps.knowledge && (await handleLearned(message))) continue;
      if (deps.autonomous) {
        ui.info("Je n'ai pas tout saisi, mais pas d'inquiétude : je regarde l'état complet de votre ordinateur pour trouver la cause.");
        await handleRepair();
      } else {
        await handleUnclear();
      }
      continue;
    }

    if (intent.kind === 'repair') {
      await handleRepair();
    } else if (intent.kind === 'server') {
      await handleServer(intent.host);
    } else if (intent.kind === 'mapdrive') {
      await handleMapDrive(intent.letter, intent.unc);
    } else if (intent.kind === 'install') {
      await handleInstall(intent.app);
    } else if (intent.kind === 'company') {
      await handleCompany();
    } else if (intent.kind === 'training') {
      await handleTraining(intent.topic);
    } else if (intent.kind === 'human_only') {
      ui.info(HUMAN_ONLY_TEXT[intent.topic]);
      await offerTechnician();
    } else if (intent.kind === 'skill') {
      const skill = resolve(intent.skillId);
      if (!skill) {
        ui.info("Je ne peux pas traiter cela automatiquement.");
        await offerTechnician();
        continue;
      }
      outcomes.push(await runAndNote(skill));
    } else if (intent.kind === 'uninstall') {
      await handleUninstall(intent.query);
    } else if (intent.kind === 'chat') {
      await handleQuestion(message);
    }
  }

  if (ui.wasHandedOff?.()) handedOver = true;
  ui.progress?.(4);
  if (!handedOver) ui.info('Merci. N\'hésitez pas à me redemander de l\'aide à tout moment.');
  return { turns, handedOver, escalationFailed: escalationFailed || undefined, outcomes };

  // --- étapes ---

  function describe(intent: Intent): string {
    if (intent.kind === 'skill') return SKILL_MENU.find((c) => c.id === intent.skillId)?.label ?? `Le service « ${intent.skillId.replace(/^service:/, '')} »`;
    if (intent.kind === 'uninstall') return `Désinstaller « ${intent.query} »`;
    if (intent.kind === 'repair') return 'Réparer mon PC (analyse complète)';
    if (intent.kind === 'server') return "Vérifier l'accès à un serveur";
    if (intent.kind === 'mapdrive') return 'Connecter un lecteur réseau';
    if (intent.kind === 'install') return intent.app ? `Installer ${INSTALL_CATALOG.find((a) => a.key === intent.app)?.label ?? intent.app}` : 'Installer un logiciel';
    if (intent.kind === 'training') return 'Me former (explications et exercices)';
    if (intent.kind === 'company') return 'Rattacher ce PC à mon entreprise';
    if (intent.kind === 'human_only') return 'Demander un technicien (hors de mon domaine)';
    if (intent.kind === 'chat') return 'Répondre à ma question (explication)';
    return 'Urgence';
  }

  async function runAndNote(skill: Skill): Promise<Outcome> {
    const outcome = await runSkill(skill, { runner, ui, reporter, machine: deps.machine, readOnly: deps.scope === 'diagnostic', friendly: deps.autonomous, isAdmin: deps.isAdmin });
    // Si le serveur n'a pas enregistré la demande, la conversation continue : le client peut réessayer ou utiliser le bouton.
    if (outcome.status === 'escalated' && outcome.recorded) handedOver = true;
    else if (outcome.status === 'fixed') ui.info('Parfait, c\'est réglé.');
    return outcome;
  }

  /** Résultat à retenir pour la mémoire : seule une correction confirmée par le client compte comme un succès. */
  function learnResultOf(outcome: Outcome): LearnResult {
    if (outcome.status === 'fixed') return outcome.actionsDone.length > 0 ? 'resolved' : 'unverified';
    if (outcome.status === 'declined') return 'declined';
    if (outcome.status === 'reboot_needed') return 'unverified';
    return 'not_resolved';
  }

  /**
   * Cas que l'agent ne connaît pas. Renvoie true si une procédure a été conduite (réussie ou non : l'agent a alors
   * déjà soit réglé, soit passé la main), false si rien n'a pu être fait ici (pas de mémoire, IA indisponible, cas
   * hors du catalogue) et que l'agent doit reprendre son cheminement habituel.
   */
  async function handleLearned(message: string): Promise<boolean> {
    const knowledge = deps.knowledge!;
    const reply = await knowledge.solve(message);
    if (reply.status === 'unsupported') {
      ui.info("Ce cas dépasse ce que je sais faire seul pour l'instant. Je le note : c'est ainsi que j'apprends de nouvelles choses.");
      await log({ type: 'diagnosed', message: `Cas hors catalogue : ${reply.reason || 'raison non précisée'}`, details: { learned: 'unsupported' } });
      return false;
    }
    if (reply.status !== 'memory' && reply.status !== 'generated') return false;

    const compiled = compileProcedure(reply.procedure, reply.procedureId);
    if (!compiled.ok) {
      // L'agent est la dernière barrière : une étape hors catalogue (ou d'une autre version) n'est jamais exécutée.
      await knowledge.outcome(reply.procedureId, 'rejected_by_agent', compiled.error);
      await log({ type: 'diagnosed', message: `Procédure refusée par l'agent : ${compiled.error}`, details: { learned: 'rejected', procedureId: reply.procedureId } });
      return false;
    }

    ui.info(
      reply.status === 'generated'
        ? "Je n'avais pas encore de solution toute prête pour ce cas. J'ai demandé à notre IA de me proposer un plan : je l'ai contrôlé, il n'utilise que des opérations sûres et connues. Si cela marche, je m'en souviendrai pour la prochaine fois."
        : reply.trust === 'trusted'
          ? "Ce cas m'est connu : je l'ai déjà résolu. Je vous explique chaque étape avant de la faire."
          : "J'ai déjà un plan préparé pour ce cas. Je ne fais que des opérations sûres et connues, et je vérifie le résultat avec vous.",
    );
    await log({ type: 'diagnosed', message: `Procédure ${reply.status === 'generated' ? 'proposée par l\'IA' : 'retrouvée en mémoire'} : ${compiled.value.procedure.title}`, details: { learned: reply.status, trust: reply.trust, procedureId: reply.procedureId } });

    const outcome = await runAndNote(compiled.value.skill);
    outcomes.push(outcome);
    await knowledge.outcome(reply.procedureId, learnResultOf(outcome));
    return true;
  }

  async function handleUnclear() {
    ui.info("Je n'ai pas bien compris. Choisissez ce qui s'en rapproche le plus :");
    const options = [
      'Réparer mon PC (analyse complète)',
      'Un problème précis (son, Internet, imprimante, Outlook…)',
      'Installer un logiciel',
      'Me former (Windows, Office, mon métier)',
      'Désinstaller un logiciel',
      'Poser une question (Office, Windows…)',
      'Parler à un technicien',
    ];
    const pick = await ui.choose('Que voulez-vous faire ?', options);
    if (pick === null) return;
    if (pick === 0) await handleRepair();
    else if (pick === 1) {
      const which = await ui.choose('Quel problème ?', [...SKILL_MENU.map((c) => c.label), 'Retour']);
      if (which !== null && which < SKILL_MENU.length) {
        const skill = resolve(SKILL_MENU[which]!.id);
        if (skill) outcomes.push(await runAndNote(skill));
      }
    } else if (pick === 2) await handleInstall(undefined);
    else if (pick === 3) await handleTraining('');
    else if (pick === 4) {
      const name = await ui.ask('Quel logiciel voulez-vous désinstaller ?');
      if (name) await handleUninstall(name.trim());
    } else if (pick === 5) {
      const q = await ui.ask('Quelle est votre question ?');
      if (q) await handleQuestion(q.trim());
    } else {
      await handOver('Le client demande un technicien');
    }
  }

  /** Ce que le forfait n'inclut pas : dit clairement, sans rien lancer. */
  function outOfScope(what: string): boolean {
    if (deps.scope === 'diagnostic' && what !== 'repair') {
      ui.info("Cette action modifie votre ordinateur : elle n'est pas comprise dans cette assistance en lecture seule. Choisissez l'offre « Assistance IA » pour que je la fasse avec vous.");
      return true;
    }
    return false;
  }

  async function handleRepair() {
    if (deps.scope === 'diagnostic') {
      // Analyse complète, lecture seule : le client voit l'état de son PC, rien n'est modifié.
      const { scanPc, formatFindings } = await import('./repairPc.js');
      ui.info('Je lis l\'état de votre ordinateur (rien n\'est modifié)…');
      const findings = await scanPc(runner);
      ui.info(formatFindings(findings));
      ui.info("Cette assistance en lecture seule s'arrête là. Pour corriger ces points avec moi, choisissez l'offre « Assistance IA ».");
      return;
    }
    if (deps.scope === 'fix') {
      ui.info("L'analyse et la réparation complète du PC ne sont pas comprises dans cette assistance. Décrivez un problème précis (Internet, imprimante, Outlook, lenteur…).");
      return;
    }
    const out = await repairMyPc({ runner, ui, reporter, machine: deps.machine, friendly: deps.autonomous, isAdmin: deps.isAdmin });
    if (out.status === 'repaired' || out.status === 'partial') {
      if (out.escalated) handedOver = true;
      else if (out.status === 'repaired' && out.reboot !== 'accepted') ui.info("Parfait, votre ordinateur est en bon état.");
    }
  }

  /** Demande une valeur au client, valide sa forme, et la redemande une fois si elle est refusée. */
  async function askValid(prompt: string, valid: (v: string) => boolean, hint: string, first?: string): Promise<string | null> {
    let value = first?.trim();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!value || !valid(value)) {
        if (value) ui.info(hint);
        const answer = await ui.ask(prompt);
        if (answer === null) return null;
        value = answer.trim();
      }
      if (value && valid(value)) return value;
    }
    ui.info(hint);
    return null;
  }

  async function handleServer(host?: string) {
    const target = await askValid(
      "Quel est le nom ou l'adresse du serveur ? (par exemple serveur-compta ou 192.168.1.10)",
      (v) => SERVER_HOST.test(v),
      "Je n'accepte qu'un nom ou une adresse IP (lettres, chiffres, points et tirets).",
      host,
    );
    if (!target) return;
    const reach = await runAndNote(serverCheckSkill(target));
    outcomes.push(reach);
    // Joignable : proposer, en lecture seule, l'état du serveur (disque, mémoire, services).
    if (reach.status === 'fixed') {
      const pick = await ui.choose(`Voulez-vous aussi voir l'état de « ${target} » (disque, mémoire, services) ? Lecture seule, avec votre session Windows.`, ['Oui, voir l’état', 'Non merci']);
      if (pick === 0) outcomes.push(await runAndNote(serverHealthSkill(target)));
    }
  }

  async function handleMapDrive(letter?: string, unc?: string) {
    if (outOfScope('mapdrive')) return;
    const path = await askValid('Quel est le chemin du dossier partagé ? (par exemple \\\\serveur\\Compta)', (v) => UNC_PATH.test(v), 'Le chemin doit avoir la forme \\\\serveur\\partage.', unc);
    if (!path) return;
    const drive = await askValid('Quelle lettre de lecteur voulez-vous ? (de D à Z, par exemple Z)', (v) => DRIVE_LETTER.test(v.replace(/:$/, '').toUpperCase()), 'La lettre doit aller de D à Z.', letter);
    if (!drive) return;
    outcomes.push(await runAndNote(mapDriveSkill(drive.replace(/:$/, '').toUpperCase(), path)));
  }

  async function handleCompany() {
    if (!deps.company) {
      ui.info("Pour rattacher ce PC à votre entreprise, connectez-vous d'abord avec votre adresse email (relancez le programme). Le code vous est donné par l'administrateur de votre entreprise, dans son espace entreprise.");
      return;
    }
    const code = await askValid('Entrez le code de rattachement donné par votre administrateur (exemple : ABCDE-FGHJK) :', (v) => /^[A-Za-z0-9 -]{8,20}$/.test(v), 'Ce code ne ressemble pas à un code de rattachement (10 lettres et chiffres).');
    if (!code) return;
    const device = (deps.machine ?? 'PC').slice(0, 40);
    const result = await deps.company.join(code, device);
    if (result.ok) {
      ui.info(`C'est fait : ce PC (« ${device} ») est maintenant rattaché à l'entreprise « ${result.companyName} ». Son état de santé (espace disque, antivirus, mises à jour) sera visible par votre administrateur. Aucun fichier ni document n'est transmis.`);
      await log({ type: 'user_request', message: 'Rattachement à une entreprise' });
    } else {
      ui.info(result.error);
    }
  }

  async function handleInstall(app?: string) {
    if (outOfScope('install')) return;
    let key = app;
    if (!key) {
      ui.info('Je peux installer ces logiciels gratuits depuis le dépôt officiel de Microsoft (winget). Pour un autre logiciel, un technicien vous aidera.');
      const pick = await ui.choose('Quel logiciel voulez-vous installer ?', [...INSTALL_CATALOG.map((a) => a.label), 'Un autre logiciel (technicien)']);
      if (pick === null) return;
      if (pick >= INSTALL_CATALOG.length) {
        await offerTechnician();
        return;
      }
      key = INSTALL_CATALOG[pick]!.key;
    }
    outcomes.push(await runAndNote(installSkill(key)));
  }

  async function handleTraining(topic: string) {
    const result = await runTraining({ ui, assistant: deps.assistant }, topic || undefined);
    if (result.unavailable && result.lessons === 0) await offerTechnician();
  }

  async function handleUninstall(query: string) {
    if (outOfScope('uninstall')) return;
    let programs: InstalledProgram[];
    try {
      programs = await listInstalledPrograms(runner);
    } catch (err) {
      ui.info("Je n'arrive pas à lire la liste de vos logiciels.");
      await handOver(`Liste des logiciels illisible : ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const matches = findPrograms(programs, query);
    if (matches.length === 0) {
      ui.info(`Je ne trouve aucun logiciel qui ressemble à « ${query} » parmi vos logiciels installés.`);
      return;
    }
    let target = matches[0]!;
    if (matches.length > 1) {
      const labels = matches.map((p) => `${p.name}${p.version ? ` ${p.version}` : ''}${p.publisher ? ` — ${p.publisher}` : ''}`);
      const pick = await ui.choose(`J'ai trouvé plusieurs logiciels pour « ${query} ». Lequel voulez-vous désinstaller ?`, [...labels, 'Aucun de ceux-là']);
      if (pick === null || pick >= matches.length) return;
      target = matches[pick]!;
    } else {
      ui.info(`J'ai trouvé : ${target.name}${target.version ? ` ${target.version}` : ''}${target.publisher ? ` (${target.publisher})` : ''}.`);
    }
    const plan = planUninstall(target, deps.roots);
    if (!plan.ok) {
      ui.info(`Je ne désinstalle pas « ${target.name} » moi-même. ${plan.reason}`);
      await offerTechnician();
      return;
    }
    outcomes.push(await runAndNote(uninstallProgramSkill(target, deps.roots)));
  }

  async function handleQuestion(question: string) {
    if (deps.assistant && !privacyNoted) {
      privacyNoted = true;
      ui.info("Votre question est transmise à notre assistant en ligne (une IA). N'y écrivez jamais de mot de passe, de code reçu par SMS ou de numéro de carte.");
    }
    // Capture d'écran : jointe avant (bouton 📎 de la page) ou demandée quand le client dit qu'il est bloqué sur un écran.
    let image = ui.takeAttachment?.() ?? undefined;
    if (!image && ui.takeAttachment && /capture|ecran|bloque/.test(question.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())) {
      const answered = await ui.ask("Pour que je voie votre écran, joignez une capture avec le bouton « 📎 » sous la zone de réponse, puis écrivez « ok ». Écrivez « sans » pour continuer sans capture.");
      if (answered !== null) image = ui.takeAttachment() ?? undefined;
    }
    // Le message courant part à part : l'historique ne contient que les échanges précédents.
    const reply = deps.assistant ? await deps.assistant.answer(truncate(question, 1000), history.slice(-8), image ? { image } : undefined) : ({ available: false } as const);
    if (!reply.available) {
      ui.info("L'assistant en ligne n'est pas disponible pour le moment.");
      await offerTechnician();
      return;
    }
    history.push({ role: 'user', text: truncate(question, 1000) }, { role: 'assistant', text: truncate(reply.text, 1500) });
    ui.info(reply.text);
    const helped = await ui.confirmFixed('Cette réponse vous aide-t-elle ?');
    if (!helped) await offerTechnician();
  }
}
