import { runSkill, type Outcome } from './agent.js';
import type { Assistant, ChatTurn } from './assistant.js';
import { routeIntent, type Intent } from './router.js';
import { SKILL_MENU, resolveSkill } from './skills/index.js';
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
}

export interface ConversationResult {
  turns: number;
  /** Un technicien a été demandé (par l'agent ou par le client). */
  handedOver: boolean;
  outcomes: Outcome[];
}

const GREETING =
  "Bonjour, je suis l'assistant Tech Assist. Dites-moi en une phrase ce qui ne va pas — par exemple « je n'ai plus de son », « mon imprimante ne marche pas », « je n'ai pas Internet », « je pense avoir un virus », « Outlook plante », « je veux désinstaller Skype » — ou posez-moi une question sur Office.";

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

    if (intent.kind === 'skill') {
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
    if (intent.kind === 'chat') return 'Répondre à ma question (explication)';
    return 'Urgence';
  }

  async function runAndNote(skill: Skill): Promise<Outcome> {
    const outcome = await runSkill(skill, { runner, ui, reporter });
    // Si le serveur n'a pas enregistré la demande, la conversation continue : le client peut réessayer ou utiliser le bouton.
    if (outcome.status === 'escalated' && outcome.recorded) handedOver = true;
    else if (outcome.status === 'fixed') ui.info('Parfait, c\'est réglé.');
    return outcome;
  }

  async function handleUnclear() {
    ui.info("Je n'ai pas bien compris. Choisissez ce qui s'en rapproche le plus :");
    const options = [...SKILL_MENU.map((c) => c.label), 'Désinstaller un logiciel', 'Poser une question (Office, Windows…)', 'Parler à un technicien'];
    const pick = await ui.choose('Que voulez-vous faire ?', options);
    if (pick === null) return;
    if (pick < SKILL_MENU.length) {
      const skill = resolve(SKILL_MENU[pick]!.id);
      if (skill) outcomes.push(await runAndNote(skill));
    } else if (pick === SKILL_MENU.length) {
      const name = await ui.ask('Quel logiciel voulez-vous désinstaller ?');
      if (name) await handleUninstall(name.trim());
    } else if (pick === SKILL_MENU.length + 1) {
      const q = await ui.ask('Quelle est votre question ?');
      if (q) await handleQuestion(q.trim());
    } else {
      await handOver('Le client demande un technicien');
    }
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
    // Le message courant part à part : l'historique ne contient que les échanges précédents.
    const reply = deps.assistant ? await deps.assistant.answer(truncate(question, 1000), history.slice(-8)) : ({ available: false } as const);
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
