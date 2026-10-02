import type { Action, Diagnosis, Skill } from '../types.js';
import { asArray, extractJson, guarded, readScript, runScript, safeLabel, tracked } from './common.js';

/**
 * Programmes au démarrage. L'agent n'écrit PAS dans le registre : il ouvre la page officielle
 * « Applications de démarrage » des Paramètres, où le client désactive lui-même ce qu'il veut.
 */

export interface StartupFacts {
  items: { name: string; location: string }[];
  admin: boolean | null;
}

/** Lecture seule : commandes lancées au démarrage de Windows et à l'ouverture de session. */
export const COLLECT_SCRIPT = guarded(String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$items = @(Get-CimInstance -ClassName Win32_StartupCommand | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; location = [string]$_.Location } })
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ items = $items; admin = $admin } | ConvertTo-Json -Depth 3 -Compress
`);

export function parseStartupFacts(stdout: string): StartupFacts {
  const raw = extractJson(stdout);
  return {
    items: asArray<Record<string, unknown>>(raw.items).map((i) => ({ name: safeLabel(i.name, 60), location: safeLabel(i.location, 80) })).filter((i) => i.name),
    admin: typeof raw.admin === 'boolean' ? raw.admin : null,
  };
}

/** Au-delà, le démarrage est visiblement chargé. */
export const MANY_STARTUP = 10;

const openStartupSettings = (): Action => ({
  id: 'open_startup_settings',
  title: 'Ouvrir la liste des programmes au démarrage',
  explanation: "J'ouvre la page « Applications de démarrage » des Paramètres Windows. Vous y désactivez avec les interrupteurs les programmes dont vous n'avez pas besoin dès l'allumage (messageries, lanceurs de jeux, mises à jour d'applis…). Rien n'est supprimé et vous pouvez les réactiver à tout moment.",
  requiresAdmin: false,
  verified: true,
  followUp: "La page est ouverte : désactivez les programmes inutiles (gardez l'antivirus, les pilotes et vos logiciels de travail), puis revenez ici.",
  run: (runner) => runScript(runner, guarded(`Start-Process 'ms-settings:startupapps'\nWrite-Output 'OK'`)),
});

export function diagnoseStartup(facts: StartupFacts, opened = false): Diagnosis {
  const many = facts.items.length > MANY_STARTUP && !opened;
  const names = facts.items.slice(0, 8).map((i) => i.name).join(', ');
  return {
    summary: many ? `${facts.items.length} programmes se lancent au démarrage de Windows (dont : ${names}). Cela ralentit l'allumage.` : `${facts.items.length} programme(s) au démarrage : c'est raisonnable.`,
    problems: many ? ['many_startup'] : [],
    actions: many ? [openStartupSettings()] : [],
    advice: [],
    healthy: !many,
    needsHuman: false,
  };
}

export function startupSkill(): Skill {
  const tried = new Set<string>();
  return {
    id: 'startup',
    title: 'Démarrage : programmes qui ralentissent',
    verifyQuestion: 'Windows démarre-t-il plus vite ?',
    async diagnose(runner) {
      const d = diagnoseStartup(parseStartupFacts(await readScript(runner, COLLECT_SCRIPT, 'Le diagnostic du démarrage')), tried.has('open_startup_settings'));
      return { ...d, actions: tracked(d.actions, tried) };
    },
  };
}
