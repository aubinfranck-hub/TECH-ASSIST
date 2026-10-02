import type { Skill } from '../types.js';
import { PROFILES, customServiceSkill, serviceSkill, windowsHealthSkill } from './services.js';
import { soundSkill } from './sound.js';

export interface SkillChoice {
  /** Identifiant utilisable en ligne de commande (`--skill`). */
  id: string;
  /** Texte du menu montré au client. */
  label: string;
  build(): Skill;
}

/** Ce que le client peut demander, dans l'ordre du menu. */
export const SKILL_MENU: SkillChoice[] = [
  { id: 'sound', label: 'Pas de son', build: () => soundSkill },
  { id: 'print', label: "Impression : l'imprimante ne répond pas", build: () => serviceSkill('print') },
  { id: 'network', label: 'Internet / Wi-Fi / réseau', build: () => serviceSkill('network') },
  { id: 'update', label: 'Mises à jour Windows bloquées', build: () => serviceSkill('update') },
  { id: 'bluetooth', label: 'Bluetooth', build: () => serviceSkill('bluetooth') },
  { id: 'search', label: 'Recherche Windows', build: () => serviceSkill('search') },
  { id: 'time', label: 'Date et heure incorrectes', build: () => serviceSkill('time') },
  { id: 'windows', label: 'Analyse complète des services Windows', build: windowsHealthSkill },
];

/** `sound`, un domaine (`print`…), `windows` (tout), ou `service:Nom` (un service précis). */
export function resolveSkill(id: string): Skill | undefined {
  if (id.startsWith('service:')) {
    try {
      return customServiceSkill(id.slice('service:'.length));
    } catch {
      return undefined; // nom invalide (voir SERVICE_NAME) : rejeté, jamais passé à PowerShell
    }
  }
  if (id === 'sound') return soundSkill;
  if (id === 'windows') return windowsHealthSkill();
  if (id in PROFILES && id !== 'core' && id !== 'audio') return serviceSkill(id);
  return undefined;
}
