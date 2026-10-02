import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { runSkill } from './agent.js';
import { AppApi, DEFAULT_API_BASE, FileAccountStore, readHardwareHash, signIn, startCovered } from './appAccount.js';
import { HttpAssistant, type Assistant } from './assistant.js';
import { ChatUi } from './chatServer.js';
import { converse } from './conversation.js';
import { PowerShellRunner } from './powershell.js';
import { repairMyPc } from './repairPc.js';
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

function openBrowser(url: string) {
  // Navigateur par défaut de Windows ; l'adresse ne contient aucun caractère spécial du shell.
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function main() {
  if (process.platform !== 'win32') {
    console.error("Cet agent fonctionne uniquement sous Windows pour l'instant.");
    process.exit(2);
  }

  // Compte rendu au serveur : seulement si l'application a une session ouverte.
  const reporters: Reporter[] = [new ConsoleReporter()];
  const apiBase = arg('api') ?? process.env.TECH_ASSIST_API;
  const token = arg('token') ?? process.env.TECH_ASSIST_TOKEN;
  const sessionId = arg('session') ?? process.env.TECH_ASSIST_SESSION;
  const online = !!(apiBase && token && sessionId);
  if (online) reporters.push(new HttpReporter(apiBase!, token!, sessionId!));
  const reporter = new CompositeReporter(reporters);
  const assistant: Assistant | undefined = online ? new HttpAssistant(apiBase!, token!, sessionId!) : undefined;
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
    const result = await converse({ runner, ui: consoleUi(rl), reporter, assistant, machine });
    console.log(`\nConversation terminée (${result.turns} demande(s)${result.handedOver ? ', technicien demandé' : ''}).`);
    rl.close();
    process.exit(0);
  }

  const chat = await ChatUi.start();
  console.log(`Ouverture de l'assistant dans votre navigateur : ${chat.url}`);
  if (!flag('no-browser')) openBrowser(chat.url);

  // Sans session fournie en ligne de commande (cas du double-clic) : connexion par email, puis assistance couverte.
  let conversationReporter: Reporter = reporter;
  let conversationAssistant: Assistant | undefined = assistant;
  if (!online && !flag('offline')) {
    const api = new AppApi(apiBase ?? DEFAULT_API_BASE);
    const deps = { ui: chat, api, store: new FileAccountStore(), hardwareHash: await readHardwareHash(runner) };
    const login = await signIn(deps);
    const started = login ? await startCovered(deps, login) : null;
    if (started) {
      const base = apiBase ?? DEFAULT_API_BASE;
      conversationReporter = new CompositeReporter([new ConsoleReporter(), new HttpReporter(base, started.token, started.sessionId)]);
      conversationAssistant = new HttpAssistant(base, started.token, started.sessionId);
      chat.info(
        started.fallbackToHuman
          ? "L'agent IA n'est pas disponible pour le moment : un technicien prendra le relais. Décrivez votre problème."
          : started.coverage === 'free_offer'
            ? 'Votre assistance offerte est démarrée.'
            : 'Votre abonnement est actif.',
      );
    } else {
      chat.info("Je continue sans compte : je peux réparer votre PC, mais l'assistant en ligne (questions, formation) n'est pas disponible.");
    }
  }

  chat.onHandoff = () => {
    conversationReporter.event({ type: 'escalated', skill: 'conversation', message: 'Le client demande un technicien' }).catch(() => undefined);
  };
  const result = await converse({ runner, ui: chat, reporter: conversationReporter, assistant: conversationAssistant, machine });
  await new Promise((r) => setTimeout(r, 1500)); // laisse la page afficher le dernier message
  await chat.close();
  console.log(`Conversation terminée (${result.turns} demande(s)${result.handedOver ? ', technicien demandé' : ''}).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
