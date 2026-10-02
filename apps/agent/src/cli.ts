import { createInterface } from 'node:readline/promises';
import { runSkill } from './agent.js';
import { PowerShellRunner } from './powershell.js';
import { CompositeReporter, ConsoleReporter, HttpReporter } from './reporters.js';
import { soundSkill } from './skills/sound.js';
import type { Action, Reporter, Skill, Ui } from './types.js';

const SKILLS: Record<string, Skill> = { [soundSkill.id]: soundSkill };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function consoleUi(): Ui {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
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

async function main() {
  const skillId = arg('skill') ?? 'sound';
  const skill = SKILLS[skillId];
  if (!skill) {
    console.error(`Compétence inconnue : ${skillId}. Disponibles : ${Object.keys(SKILLS).join(', ')}`);
    process.exit(2);
  }
  if (process.platform !== 'win32') {
    console.error("Cet agent fonctionne uniquement sous Windows pour l'instant.");
    process.exit(2);
  }

  // Compte rendu au serveur : seulement si l'application a une session ouverte.
  const reporters: Reporter[] = [new ConsoleReporter()];
  const apiBase = arg('api') ?? process.env.TECH_ASSIST_API;
  const token = arg('token') ?? process.env.TECH_ASSIST_TOKEN;
  const sessionId = arg('session') ?? process.env.TECH_ASSIST_SESSION;
  if (apiBase && token && sessionId) reporters.push(new HttpReporter(apiBase, token, sessionId));

  const ui = consoleUi();
  const outcome = await runSkill(skill, { runner: new PowerShellRunner(), ui, reporter: new CompositeReporter(reporters) });
  console.log(`\nRésultat : ${outcome.status}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
