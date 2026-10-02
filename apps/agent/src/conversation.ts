import { runSkill, type Outcome } from './agent.js';
import type { Assistant, ChatTurn } from './assistant.js';
import { repairMyPc } from './repairPc.js';
import { routeIntent, type HumanOnlyTopic, type Intent } from './router.js';
import { SKILL_MENU, resolveSkill } from './skills/index.js';
import { INSTALL_CATALOG, installSkill } from './skills/install.js';
import { DRIVE_LETTER, UNC_PATH, mapDriveSkill } from './skills/mapDrive.js';
import { SERVER_HOST, serverCheckSkill } from './skills/serverCheck.js';
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
  company?: { join(code: string, deviceName: string): Promise<{ ok: true; companyName: string } | { ok: false; error: string }> };
}

export interface ConversationResult {
  turns: number;
  /** Un technicien a été demandé (par l'agent ou par le client). */
  handedOver: boolean;
  outcomes: Outcome[];
}

const GREETING =
  "Bonjour, je suis AI PC, votre technicien informatique. Dites-moi en une phrase ce que vous voulez — par exemple « mon ordinateur est lent » (je l'analyse et je le répare), « je n'ai pas Internet », « mon imprimante ne marche pas », « je n'accède pas au serveur », « je pense avoir un virus », « Outlook plante », « installe VLC », « je veux désinstaller Skype » — ou « apprends-moi Excel » pour une formation, ou posez-moi une question sur Office.";

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
  const { runner, ui, reporter } = deps;
  const resolve = deps.resolve ?? resolveSkill;
  const history: ChatTurn[] = [];
  const outcomes: Outcome[] = [];
  let turns = 0;
  let handedOver = false;
  let privacyNoted = false;

  const log = async (event: Omit<AgentEvent, 'skill'>) => {
    try {
      await reporter.event({ ...event, skill: 'conversation', message: event.message === undefined ? undefined : truncate(event.message, 500) });
    } catch (err) {
      console.error(`[journal] impossible d'enregistrer « ${event.type} » :`, err instanceof Error ? err.message : err);
    }
  };

  const handOver = async (reason: string) => {
    handedOver = true;
    await log({ type: 'escalated', message: reason });
    ui.info("Je passe la main à un technicien, qui verra notre conversation et tout ce que j'ai constaté.");
  };

  const offerTechnician = async () => {
    const choice = await ui.choose('Voulez-vous qu\'un technicien prenne le relais ?', ['Oui, un technicien', 'Non merci']);
    if (choice === 0) await handOver('Le client demande un technicien');
  };

  ui.info(GREETING);
  let first = true;
  while (!handedOver) {
    const text = await ui.ask(first ? 'Que puis-je faire pour vous ?' : 'Autre chose ? (écrivez « non » pour terminer)');
    if (text === null || (!first && GOODBYE.test(text))) break;
    const message = text.trim();
    if (!message) continue;
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
    if (intents.length > 1) {
      const labels = intents.map(describe);
      const pick = await ui.choose('Je peux traiter plusieurs choses. Par laquelle commencer ?', labels);
      if (pick === null) continue;
      intents = [intents[pick]!];
    }
    const intent = intents[0];

    if (!intent) {
      await handleUnclear();
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
  if (!handedOver) ui.info('Merci. N\'hésitez pas à me redemander de l\'aide à tout moment.');
  return { turns, handedOver, outcomes };

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
    const outcome = await runSkill(skill, { runner, ui, reporter, machine: deps.machine });
    // Si le serveur n'a pas enregistré la demande, la conversation continue : le client peut réessayer ou utiliser le bouton.
    if (outcome.status === 'escalated' && outcome.recorded) handedOver = true;
    else if (outcome.status === 'fixed') ui.info('Parfait, c\'est réglé.');
    return outcome;
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

  async function handleRepair() {
    const out = await repairMyPc({ runner, ui, reporter, machine: deps.machine });
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
    outcomes.push(await runAndNote(serverCheckSkill(target)));
  }

  async function handleMapDrive(letter?: string, unc?: string) {
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
