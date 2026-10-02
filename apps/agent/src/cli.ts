import { createInterface } from 'node:readline/promises';
import { runSkill } from './agent.js';
import { PowerShellRunner } from './powershell.js';
import { CompositeReporter, ConsoleReporter, HttpReporter } from './reporters.js';
import { SKILL_MENU, resolveSkill } from './skills/index.js';
import type { Action, Reporter, Skill, Ui } from './types.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function consoleUi(rl: ReturnType<typeof createInterface>): Ui {
  const yes = async (question: string) => {
    const answer = (await rl.question(`${question} [o/n] `)).trim().toLowerCase();
    return answer === 'o' || answer === 'oui' || answer === 'y';
  };
  return {
    info: (message) => console.log(message),
    confirmAction: (action: Action) => yes(`\n${action.title}\n${action.explanation}\nJe peux le faire ?`),
    confirmFixed: (question) => yes(question),
  };
}

/** Sans `--skill` ni `--service`, le client choisit son problème dans un menu. */
async function chooseSkill(rl: ReturnType<typeof createInterface>): Promise<Skill> {
  const explicit = arg('skill') ?? (arg('service') ? `service:${arg('service')}` : undefined);
  if (explicit) {
    const skill = resolveSkill(explicit);
    if (!skill) {
      console.error(`Compétence inconnue : ${explicit}. Disponibles : ${SKILL_MENU.map((c) => c.id).join(', ')}, service:<nom>`);
      process.exit(2);
    }
    return skill;
  }
  const other = SKILL_MENU.length + 1;
  console.log('\nQuel est votre problème ?');
  SKILL_MENU.forEach((choice, index) => console.log(`  ${index + 1}. ${choice.label}`));
  console.log(`  ${other}. Un autre service Windows (je tape son nom)`);
  for (;;) {
    const answer = Number((await rl.question('Votre choix : ')).trim());
    if (Number.isInteger(answer) && answer >= 1 && answer <= SKILL_MENU.length) return SKILL_MENU[answer - 1]!.build();
    if (answer === other) {
      const name = (await rl.question('Nom du service (comme dans services.msc) : ')).trim();
      const skill = resolveSkill(`service:${name}`);
      if (skill) return skill;
      console.log('Nom invalide (lettres, chiffres, _ . - uniquement).');
    } else {
      console.log(`Tapez un numéro entre 1 et ${other}.`);
    }
  }
}

async function main() {
  if (process.platform !== 'win32') {
    console.error("Cet agent fonctionne uniquement sous Windows pour l'instant.");
    process.exit(2);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const skill = await chooseSkill(rl);

  // Compte rendu au serveur : seulement si l'application a une session ouverte.
  const reporters: Reporter[] = [new ConsoleReporter()];
  const apiBase = arg('api') ?? process.env.TECH_ASSIST_API;
  const token = arg('token') ?? process.env.TECH_ASSIST_TOKEN;
  const sessionId = arg('session') ?? process.env.TECH_ASSIST_SESSION;
  if (apiBase && token && sessionId) reporters.push(new HttpReporter(apiBase, token, sessionId));

  const ui = consoleUi(rl);
  const outcome = await runSkill(skill, { runner: new PowerShellRunner(), ui, reporter: new CompositeReporter(reporters) });
  console.log(`\nRésultat : ${outcome.status}`);
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
