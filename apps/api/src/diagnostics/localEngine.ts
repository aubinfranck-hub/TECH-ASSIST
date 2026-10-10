import type { DiagnosticAnswers, DiagnosticResult } from './types.js';

/**
 * Moteur de secours, sans dépendance externe : prend le relais si Gemini est
 * indisponible ou si aucune clé n'est configurée. Volontairement prudent —
 * mieux vaut une confiance basse honnête qu'une fausse certitude (cf. audit AU-écart).
 */
const HARDWARE_KEYWORDS = [
  'écran cassé',
  'casse',
  'tombé',
  'mouillé',
  'liquide',
  'ne s\'allume plus',
  'batterie gonflée',
  'fumée',
  'odeur de brûlé',
];

const RULES: Array<{
  keywords: string[];
  causes: string[];
  actions: string[];
  platform?: 'windows' | 'android';
}> = [
  {
    keywords: ['lent', 'lenteur', 'rame', 'freeze', 'bloque'],
    causes: ['Trop de programmes au démarrage', 'Disque saturé ou disque dur mécanique fragmenté', 'Manque de mémoire vive'],
    actions: ['Vérifier l\'espace disque libre', 'Désactiver les programmes inutiles au démarrage', 'Lancer un scan antivirus'],
  },
  {
    keywords: ['virus', 'antivirus', 'popup', 'publicité', 'ransomware'],
    causes: ['Infection par logiciel malveillant', 'Extension de navigateur indésirable'],
    actions: ['Scan antivirus complet', 'Vérifier les extensions de navigateur installées', 'Changer les mots de passe sensibles après nettoyage'],
  },
  {
    keywords: ['wifi', 'internet', 'connexion', 'réseau', 'ne se connecte pas'],
    causes: ['Pilote réseau obsolète', 'Problème côté box/routeur', 'Mot de passe Wi-Fi incorrect'],
    actions: ['Redémarrer la box et l\'appareil', 'Vérifier le mot de passe Wi-Fi', 'Mettre à jour le pilote réseau'],
  },
  {
    keywords: ['ne démarre pas', 'ne s\'allume pas', 'écran noir', 'bootloop'],
    causes: ['Problème d\'alimentation ou de batterie', 'Défaillance matérielle possible'],
    actions: ['Vérifier le chargeur et le câble', 'Tenter un redémarrage forcé'],
  },
  {
    keywords: ['stockage', 'mémoire pleine', 'espace insuffisant'],
    causes: ['Stockage saturé (photos, cache d\'applications)'],
    actions: ['Faire le tri dans les photos/vidéos', 'Vider le cache des applications'],
    platform: 'android',
  },
];

export function runLocalDiagnostic(input: DiagnosticAnswers): DiagnosticResult {
  const text = [input.problemDescription, ...Object.values(input.answers)]
    .join(' ')
    .toLowerCase();

  const outOfScope = HARDWARE_KEYWORDS.some((kw) => text.includes(kw));
  if (outOfScope) {
    return {
      summary:
        'Le problème décrit semble matériel (casse, liquide, panne physique). Ce type de panne ne peut pas être résolu à distance.',
      likelyCauses: ['Dommage matériel probable'],
      recommendedActions: [
        'Demander une intervention sur place (RV) ou un dépôt en atelier partenaire',
      ],
      confidence: 60,
      requiresRemoteSession: false,
      outOfScope: true,
      source: 'local_engine',
    };
  }

  const matched = RULES.filter(
    (rule) =>
      (!rule.platform || rule.platform === input.platform) &&
      rule.keywords.some((kw) => text.includes(kw)),
  );

  if (matched.length === 0) {
    return {
      summary:
        'Description insuffisante pour un diagnostic précis avec le moteur de secours. Un technicien pourra investiguer en session.',
      likelyCauses: [],
      recommendedActions: ['Décrire le problème avec plus de détails', 'Prendre une session avec un technicien'],
      confidence: 20,
      requiresRemoteSession: true,
      outOfScope: false,
      source: 'local_engine',
    };
  }

  const likelyCauses = [...new Set(matched.flatMap((r) => r.causes))];
  const recommendedActions = [...new Set(matched.flatMap((r) => r.actions))];

  return {
    summary: `Diagnostic préliminaire (moteur local) pour ${input.platform === 'windows' ? 'Windows' : 'Android'} : ${likelyCauses.length} cause(s) probable(s) identifiée(s).`,
    likelyCauses,
    recommendedActions,
    confidence: Math.min(70, 30 + matched.length * 15),
    requiresRemoteSession: true,
    outOfScope: false,
    source: 'local_engine',
  };
}
