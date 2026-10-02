import type { Skill } from '../types.js';
import { cleanupSkill } from './cleanup.js';
import { crashesSkill } from './crashes.js';
import { diskSkill } from './disk.js';
import { driversSkill } from './drivers.js';
import { batterySkill } from './battery.js';
import { networkMapSkill } from './networkMap.js';
import { installSkill } from './install.js';
import { malwareSkill } from './malware.js';
import { serverCheckSkill } from './serverCheck.js';
import { serverHealthSkill } from './serverHealth.js';
import { networkSkill } from './network.js';
import { officeSkill } from './office.js';
import { performanceSkill } from './performance.js';
import { printerSkill } from './printer.js';
import { securitySkill } from './security.js';
import { startupSkill } from './startup.js';
import { windowsRepairSkill } from './windowsRepair.js';
import { PROFILES, customServiceSkill, serviceSkill, windowsHealthSkill } from './services.js';
import { soundSkill } from './sound.js';

export interface SkillChoice {
  /** Identifiant utilisable en ligne de commande (`--skill`). */
  id: string;
  /** Texte du menu montré au client. */
  label: string;
  build(): Skill;
}

/** Ce que le client peut demander, dans l'ordre du menu. (La désinstallation passe par la conversation : il faut choisir le logiciel.) */
export const SKILL_MENU: SkillChoice[] = [
  { id: 'sound', label: 'Pas de son', build: () => soundSkill },
  { id: 'print', label: "Imprimante : l'impression ne fonctionne plus", build: printerSkill },
  { id: 'network', label: 'Internet / Wi-Fi / réseau', build: networkSkill },
  { id: 'lan-map', label: 'Réseau local : appareils connectés', build: networkMapSkill },
  { id: 'malware', label: 'Virus ou logiciel malveillant', build: malwareSkill },
  { id: 'office', label: 'Office / Outlook : plante ou ne répond plus', build: () => officeSkill() },
  { id: 'performance', label: 'Performances : mémoire et processeur', build: performanceSkill },
  { id: 'startup', label: 'Démarrage lent : programmes au démarrage', build: startupSkill },
  { id: 'disk', label: 'Disque : espace et santé', build: diskSkill },
  { id: 'cleanup', label: 'Nettoyage : libérer de la place', build: cleanupSkill },
  { id: 'drivers', label: 'Pilotes et appareils (webcam, micro, USB, clavier…)', build: driversSkill },
  { id: 'crashes', label: 'Plantages et redémarrages inattendus', build: crashesSkill },
  { id: 'security', label: 'Sécurité : antivirus, pare-feu, mises à jour', build: securitySkill },
  { id: 'windows-repair', label: 'Réparer les fichiers système de Windows', build: () => windowsRepairSkill({ runSfc: true }) },
  { id: 'battery', label: 'Batterie : usure', build: batterySkill },
  { id: 'update', label: 'Mises à jour Windows bloquées', build: () => serviceSkill('update') },
  { id: 'bluetooth', label: 'Bluetooth', build: () => serviceSkill('bluetooth') },
  { id: 'search', label: 'Recherche Windows', build: () => serviceSkill('search') },
  { id: 'time', label: 'Date et heure incorrectes', build: () => serviceSkill('time') },
  { id: 'windows', label: 'Analyse complète des services Windows', build: windowsHealthSkill },
];

/** `server:<hôte>`, `install:<logiciel>`, `sound`, `network`, `malware`, `office`, un domaine (`print`…), `windows` (tout), ou `service:Nom` (un service précis). */
export function resolveSkill(id: string): Skill | undefined {
  // Compétences à paramètre : le paramètre est validé (nom de serveur, catalogue fermé) ; jamais passé tel quel à PowerShell.
  if (id.startsWith('server:')) {
    try {
      return serverCheckSkill(id.slice('server:'.length));
    } catch {
      return undefined;
    }
  }
  if (id.startsWith('server-health:')) {
    try {
      return serverHealthSkill(id.slice('server-health:'.length));
    } catch {
      return undefined;
    }
  }
  if (id.startsWith('install:')) {
    try {
      return installSkill(id.slice('install:'.length));
    } catch {
      return undefined;
    }
  }
  if (id.startsWith('service:')) {
    try {
      return customServiceSkill(id.slice('service:'.length));
    } catch {
      return undefined; // nom invalide (voir SERVICE_NAME) : rejeté, jamais passé à PowerShell
    }
  }
  const choice = SKILL_MENU.find((c) => c.id === id);
  if (choice) return choice.build();
  if (id in PROFILES && id !== 'core' && id !== 'audio') return serviceSkill(id);
  return undefined;
}
