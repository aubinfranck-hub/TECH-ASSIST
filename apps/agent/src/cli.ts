import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { runSkill } from './agent.js';
import { AppApi, DEFAULT_API_BASE, FileAccountStore, answerCompanyRequest, humanAccessFor, joinCompany, readHardwareHash, signIn, startCovered, ensureContact } from './appAccount.js';
import { collectFleetHealth } from './skills/fleetStatus.js';
import { HttpAssistant, type Assistant } from './assistant.js';
import { HttpKnowledge, type Knowledge } from './knowledge.js';
import { ChatUi, DEFAULT_SITE } from './chatServer.js';
import { appWindowPlan, cleanupProfile } from './browser.js';
import { converse } from './conversation.js';
import { notifyFatal } from './fatal.js';
import { relayWithTechnician } from './humanRelay.js';
import { HttpRemote, revokeShare, shareScreen } from './remoteAccess.js';
import { makeSpeaker } from './speech.js';
import { isAdmin, launchElevated, relaunchAsAdminIfNeeded } from './elevate.js';
import { PowerShellRunner } from './powershell.js';
import { repairMyPc } from './repairPc.js';
import { AGENT_VERSION, checkForUpdate, cleanupOldVersion } from './selfUpdate.js';
import { installShortcuts } from './shortcuts.js';
import { ProgressSync } from './progressSync.js';
import { CompositeReporter, ConsoleReporter, HttpReporter } from './reporters.js';
import { resolveSkill, SKILL_MENU } from './skills/index.js';
import type { Action, ConversationUi, Reporter } from './types.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Conversation dans le terminal (option --console). */
function consoleUi(rl: ReturnType<typeof createInterface>): ConversationUi {
  const yes = async (question: string) => {
    const answer = (await rl.question(`${question} [o/n] `)).trim().toLowerCase();
    return answer === 'o' || answer === 'oui' || answer === 'y';
  };
  return {
    info: (message) => console.log(`\n${message}`),
    confirmAction: (action: Action) => yes(`\n${action.title}\n${action.explanation}\nJe peux le faire ?`),
    confirmFixed: (question) => yes(question),
    ask: async (prompt) => {
      const answer = (await rl.question(`\n${prompt}\n> `)).trim();
      return answer === '' ? null : answer;
    },
    choose: async (question, options) => {
      console.log(`\n${question}`);
      options.forEach((option, index) => console.log(`  ${index + 1}. ${option}`));
      const n = Number((await rl.question('Votre choix : ')).trim());
      return Number.isInteger(n) && n >= 1 && n <= options.length ? n - 1 : null;
    },
  };
}

let windowPlan: ReturnType<typeof appWindowPlan> = null;

function openBrowser(url: string) {
  // Fenêtre d'application (Edge ou Chrome) quand c'est possible, sinon navigateur par défaut de Windows.
  // L'adresse ne contient aucun caractère spécial du shell.
  const fallback = () => spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  windowPlan = appWindowPlan(url);
  if (!windowPlan) return fallback();
  const child = spawn(windowPlan.command, windowPlan.args, { detached: true, stdio: 'ignore' });
  child.on('error', fallback);
  child.unref();
}

async function main() {
  if (process.platform !== 'win32') {
    console.error("Cet agent fonctionne uniquement sous Windows pour l'instant.");
    process.exit(2);
  }

  // Mise à jour automatique : avant tout le reste, jamais bloquante (sans Internet ou sans droits, on continue avec cette version).
  await cleanupOldVersion();
  const update = await checkForUpdate().catch(() => ({ status: 'skipped' as const, reason: 'erreur' }));
  if (update.status === 'restarting') process.exit(0);

  // Raccourci « Tech Assist » (Bureau + menu Démarrer) au premier lancement, avant l'élévation : le Bureau est celui de l'utilisateur.
  await installShortcuts({ version: AGENT_VERSION }).catch(() => undefined);

  // Les réparations exigent les droits administrateur : on les demande une fois (fenêtre de Windows).
  if (await relaunchAsAdminIfNeeded(process.argv)) process.exit(0);

  // Compte rendu au serveur : seulement si l'application a une session ouverte.
  const reporters: Reporter[] = [new ConsoleReporter()];
  const apiBase = arg('api') ?? process.env.TECH_ASSIST_API;
  const token = arg('token') ?? process.env.TECH_ASSIST_TOKEN;
  const sessionId = arg('session') ?? process.env.TECH_ASSIST_SESSION;
  const online = !!(apiBase && token && sessionId);
  if (online) reporters.push(new HttpReporter(apiBase!, token!, sessionId!));
  const reporter = new CompositeReporter(reporters);
  const assistant: Assistant | undefined = online ? new HttpAssistant(apiBase!, token!, sessionId!) : undefined;
  const knowledge: Knowledge | undefined = online ? new HttpKnowledge(apiBase!, token!, sessionId!) : undefined;
  const runner = new PowerShellRunner();
  // Nom de l'ordinateur pour l'en-tête des rapports (affichage seulement ; jamais utilisé dans un script).
  const machine = hostname().replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 40) || undefined;

  // Mode direct : une compétence précise, dans le terminal.
  const direct = arg('skill') ?? (arg('service') ? `service:${arg('service')}` : undefined);
  if (direct === 'repair') {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const outcome = await repairMyPc({ runner, ui: consoleUi(rl), reporter, machine });
    console.log(`\nRésultat : ${outcome.status}`);
    rl.close();
    process.exit(0);
  }
  if (direct) {
    const skill = resolveSkill(direct);
    if (!skill) {
      console.error(`Compétence inconnue : ${direct}. Disponibles : repair, ${SKILL_MENU.map((c) => c.id).join(', ')}, server:<hôte>, install:<logiciel>, service:<nom>`);
      process.exit(2);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const outcome = await runSkill(skill, { runner, ui: consoleUi(rl), reporter, machine });
    console.log(`\nRésultat : ${outcome.status}`);
    rl.close();
    process.exit(0);
  }

  // Mode conversation (par défaut) : page de chat dans le navigateur, ou terminal avec --console.
  if (flag('console')) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const result = await converse({ runner, ui: consoleUi(rl), reporter, assistant, machine, knowledge });
    console.log(`\nConversation terminée (${result.turns} demande(s)${result.handedOver ? ', technicien demandé' : ''}).`);
    rl.close();
    process.exit(0);
  }

  const chat = await ChatUi.start();
  chat.showVersion(AGENT_VERSION);
  if (update.status === 'failed') chat.info(`Une nouvelle version de Tech Assist existe mais elle n'a pas pu s'installer (${update.reason}). Téléchargez-la de nouveau sur le site : le fichier se met ensuite à jour tout seul.`);
  if (online) chat.speaker = makeSpeaker(apiBase!, token!);
  console.log(`Ouverture de l'assistant dans votre navigateur : ${chat.url}`);
  if (!flag('no-browser')) openBrowser(chat.url);

  // Sans session fournie en ligne de commande (cas du double-clic) : connexion par email, puis assistance couverte.
  let conversationReporter: Reporter = reporter;
  let conversationAssistant: Assistant | undefined = assistant;
  let conversationKnowledge: Knowledge | undefined = knowledge;
  let companyDeps: Parameters<typeof converse>[0]['company'];
  let conversationScope: Parameters<typeof converse>[0]['scope'];
  let startedSession: { token: string; sessionId: string } | null = null;
  let account: { api: AppApi; store: FileAccountStore } | null = null;
  if (!online && !flag('offline')) {
    const api = new AppApi(apiBase ?? DEFAULT_API_BASE);
    const deps = { ui: chat, api, store: new FileAccountStore(), hardwareHash: await readHardwareHash(runner) };
    account = { api, store: deps.store };
    const login = await signIn(deps);
    if (login) {
      const token = login.token;
      companyDeps = { join: (code, deviceName) => joinCompany(api, token, code, deviceName) };
      // État de santé du poste pour l'espace entreprise (sans effet si le PC n'est rattaché à aucune entreprise).
      collectFleetHealth(runner).then((health) => api.heartbeat(token, health as Record<string, number | boolean>)).catch(() => undefined);
      // Demande de diagnostic de l'entreprise (lecture seule, avec l'accord de l'utilisateur).
      await answerCompanyRequest({ ui: chat, api, runner, reporter, machine }, token).catch(() => undefined);
    }
    const startDeps = { ...deps, openUrl: (u: string) => { if (!flag('no-browser')) openBrowser(u); } };
    const started = login ? await startCovered(startDeps, login) : null;
    conversationScope = started?.scope;
    if (started) {
      startedSession = { token: started.token, sessionId: started.sessionId };
      const base = apiBase ?? DEFAULT_API_BASE;
      // Offre « Assistance IA » (500 FCFA) : pas de technicien, sauf complément. Le bouton de la fenêtre et l'agent suivent la même règle.
      const human = humanAccessFor(startDeps, started);
      chat.technicianIncluded = () => human.included;
      conversationReporter = new CompositeReporter([new ConsoleReporter(), new HttpReporter(base, started.token, started.sessionId, fetch, human)]);
      conversationAssistant = new HttpAssistant(base, started.token, started.sessionId);
      conversationKnowledge = new HttpKnowledge(base, started.token, started.sessionId);
      chat.speaker = makeSpeaker(base, started.token);
      if (started.code) {
        chat.showHelpCode(started.code);
        chat.info(`Votre numéro d'aide est le ${started.code.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')} (affiché en haut de la fenêtre). Si un technicien doit se connecter, donnez-lui ce numéro.`);
      }
      // L'agent installé sur le PC fait lui-même le travail : « agent IA indisponible » ne concerne que l'assistant en ligne (questions).
      chat.info(
        started.coverage === 'free_offer'
          ? 'Votre assistance offerte est démarrée.'
          : started.coverage === 'company'
            ? "L'abonnement de votre entreprise couvre ce poste."
            : started.coverage === 'paid_forfait'
              ? started.scope === 'diagnostic'
                ? "Votre assistance est en lecture seule : j'analyse et j'explique, sans rien modifier."
                : started.humanIncluded
                  ? 'Votre forfait est actif : je commence, et un technicien prend le relais si le problème le demande.'
                  : 'Votre forfait « Assistance IA » est actif : je répare avec vous, étape par étape.'
              : 'Votre abonnement est actif.',
      );
    } else {
      chat.info("Je continue sans compte : je peux réparer votre PC, mais l'assistant en ligne (questions, formation) n'est pas disponible.");
    }
  }

  chat.progress(2);
  // Le bouton « Parler à un technicien » : on retient si le serveur a bien enregistré la demande (c'est lui qui alerte les techniciens).
  let buttonHandoff: Promise<boolean> | null = null;
  chat.onHandoff = () => {
    buttonHandoff = conversationReporter
      .event({ type: 'escalated', skill: 'conversation', message: 'Le client demande un technicien' })
      .then(() => true, () => false);
  };
  const relayTarget = () => {
    if (online) return { api: new AppApi(apiBase!), token: token!, sessionId: sessionId! };
    const base = apiBase ?? DEFAULT_API_BASE;
    return startedSession ? { api: new AppApi(base), token: startedSession.token, sessionId: startedSession.sessionId } : null;
  };
  // Le technicien suit l'intervention en direct : l'état des tâches part vers le serveur (sans effet sans session ouverte).
  // Comme AnyDesk : si le technicien tape le numéro d'aide et prend la demande, la fenêtre le détecte et passe au partage d'écran.
  const watchTarget = relayTarget();
  const watcher = watchTarget
    ? setInterval(() => {
        watchTarget.api
          .relayPoll(watchTarget.token, watchTarget.sessionId, 0)
          .then((poll) => {
            if (poll.state.claimed && !chat.wasHandedOff()) {
              clearInterval(watcher);
              chat.technicianArrived(poll.state.technician);
            }
          })
          .catch(() => undefined);
      }, 4000)
    : undefined;
  const progressTarget = relayTarget();
  const progress = progressTarget ? new ProgressSync(apiBase ?? DEFAULT_API_BASE, progressTarget.token, progressTarget.sessionId) : null;
  if (progress) chat.onTasks = (snapshot) => progress.update(snapshot);
  const result = await converse({ runner, ui: chat, reporter: conversationReporter, assistant: conversationAssistant, knowledge: conversationKnowledge, machine, company: companyDeps, scope: conversationScope, autonomous: true, isAdmin: isAdmin(), requestAdmin: () => launchElevated(process.argv) });
  if (watcher) clearInterval(watcher);
  if (result.handedOver && !result.relaunched) {
    const recorded = !result.escalationFailed && (buttonHandoff ? await buttonHandoff : true);
    const target = relayTarget();
    if (recorded && target) {
      chat.resumeAfterHandoff();
      // Avec l'accord du client, l'écran du PC est partagé avec le technicien (RustDesk) avant la discussion.
      // Les coordonnées ne sont demandées qu'ici, quand un technicien intervient (rien à saisir pour démarrer).
      if (account) await ensureContact({ ui: chat, api: account.api, store: account.store }, target.token).catch(() => false);
      const shared = await shareScreen({ ui: chat, runner, remote: new HttpRemote(apiBase ?? DEFAULT_API_BASE, target.token, target.sessionId) });
      try {
        await relayWithTechnician({ ui: chat, api: target.api, token: target.token, sessionId: target.sessionId });
      } finally {
        // Fin de l'assistance : plus aucun accès à distance n'est conservé sur le PC.
        if (shared === 'shared') await revokeShare(runner);
      }
    } else {
      chat.info(
        `Je n'ai pas réussi à prévenir un technicien (connexion Internet, ou assistance non démarrée). Réessayez dans un moment, ou écrivez-nous depuis ${DEFAULT_SITE.replace('https://', '')} : votre demande sera traitée.`,
      );
    }
  }
  if (!result.relaunched) chat.info("C'est terminé. Tech Assist se ferme : aucun accès n'est conservé sur votre ordinateur, aucun compte n'a été créé.");
  progress?.stop();
  await Promise.race([progress?.flush(), new Promise((r) => setTimeout(r, 3000))]); // dernier état envoyé au technicien
  await new Promise((r) => setTimeout(r, 1500)); // laisse la page afficher le dernier message
  await chat.close();
  cleanupProfile(windowPlan);
  console.log(`Conversation terminée (${result.turns} demande(s)${result.handedOver ? ', technicien demandé' : ''}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  notifyFatal(err);
  process.exit(1);
});
