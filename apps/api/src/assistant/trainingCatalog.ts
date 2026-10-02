/**
 * Catalogue FERMÉ de la formation : seuls ces identifiants sont acceptés par la route de chat. Le texte vient d'ici,
 * jamais du client (le client n'envoie qu'un identifiant, un niveau et une étape).
 * L'agent Windows a la même liste d'identifiants (apps/agent/src/training.ts) : les deux tests la figent.
 */

export interface TrainingTrack {
  id: string;
  label: string;
  kind: 'app' | 'profession';
  /** Ce sur quoi la formation doit se concentrer. */
  focus: string;
}

export const TRAINING_TRACKS: readonly TrainingTrack[] = [
  { id: 'windows', label: 'Windows', kind: 'app', focus: "l'utilisation de Windows 10/11 : bureau, fichiers et dossiers, paramètres, clés USB, imprimantes, captures d'écran, bonnes pratiques de sécurité" },
  { id: 'word', label: 'Word', kind: 'app', focus: 'Microsoft Word : saisie, mise en forme, styles, tableaux, images, sommaire, publipostage, relecture et mise en page de documents professionnels' },
  { id: 'excel', label: 'Excel', kind: 'app', focus: 'Microsoft Excel : saisie, formules (SOMME, SI, RECHERCHEV/RECHERCHEX), tableaux, tris et filtres, tableaux croisés dynamiques, graphiques, mise en forme' },
  { id: 'powerpoint', label: 'PowerPoint', kind: 'app', focus: 'Microsoft PowerPoint : diapositives, modèles, images, graphiques, animations sobres, présentation devant un public' },
  { id: 'outlook', label: 'Outlook', kind: 'app', focus: 'Microsoft Outlook : e-mails, pièces jointes, signature, dossiers et règles, calendrier, réunions, contacts' },
  { id: 'teams', label: 'Teams', kind: 'app', focus: 'Microsoft Teams : conversations, équipes et canaux, appels et réunions vidéo, partage d\'écran, fichiers partagés' },
  { id: 'onedrive', label: 'OneDrive', kind: 'app', focus: 'OneDrive : synchronisation, partage de fichiers et de dossiers, droits, accès hors ligne, récupération de fichiers' },
  { id: 'm365', label: 'Microsoft 365 (vue d\'ensemble)', kind: 'app', focus: "Microsoft 365 : comment Word, Excel, PowerPoint, Outlook, Teams et OneDrive se complètent au quotidien, compte, abonnement, collaboration" },
  { id: 'secretaire', label: 'Secrétariat', kind: 'profession', focus: 'le métier de secrétaire : courriers et comptes rendus (Word), agenda et e-mails (Outlook), publipostage, classement des fichiers, organisation de réunions' },
  { id: 'comptable', label: 'Comptabilité', kind: 'profession', focus: 'le métier de comptable : Excel pour les écritures, rapprochements, balances, tableaux croisés dynamiques, contrôles et formules, sauvegarde et confidentialité des données' },
  { id: 'commercial', label: 'Commercial / vente', kind: 'profession', focus: 'le métier de commercial : devis et offres (Word/Excel), suivi de clients et d\'objectifs (Excel), présentations (PowerPoint), e-mails de prospection (Outlook)' },
  { id: 'rh', label: 'Ressources humaines', kind: 'profession', focus: 'les ressources humaines : fiches du personnel, plannings et congés (Excel), contrats et courriers (Word), confidentialité des données personnelles' },
  { id: 'manager', label: 'Manager / chef d\'équipe', kind: 'profession', focus: 'le travail de manager : suivi d\'équipe et d\'indicateurs (Excel), réunions (Teams, Outlook), comptes rendus, délégation et partage de fichiers (OneDrive)' },
  { id: 'direction', label: 'Direction', kind: 'profession', focus: 'la direction : tableaux de bord et lecture de chiffres (Excel), présentations (PowerPoint), messagerie et agenda, sécurité de base des données de l\'entreprise' },
  { id: 'technicien_it', label: 'Technicien informatique', kind: 'profession', focus: "le métier de technicien informatique (notions) : fonctionnement de Windows, réseau (adresse IP, DNS, box), diagnostic méthodique d'une panne, bonnes pratiques de sécurité et de sauvegarde, relation avec l'utilisateur" },
  { id: 'logistique', label: 'Logistique / stock', kind: 'profession', focus: 'la logistique : suivi de stock et de livraisons (Excel), tableaux et formules utiles, bons de commande et courriers (Word), échanges avec les fournisseurs (Outlook)' },
  { id: 'administration', label: 'Administration', kind: 'profession', focus: "le travail administratif : courriers, formulaires, tableaux de suivi, classement et partage de documents, e-mails professionnels, archivage" },
];

export const TRAINING_LEVELS: Record<1 | 2 | 3 | 4, { label: string; goal: string }> = {
  1: { label: 'Débutant', goal: 'premiers gestes, vocabulaire de base, éviter les erreurs courantes' },
  2: { label: 'Intermédiaire', goal: 'gagner du temps au quotidien avec les outils courants' },
  3: { label: 'Avancé', goal: 'traiter des cas complexes et automatiser les tâches répétitives' },
  4: { label: 'Expert', goal: 'maîtrise professionnelle, bonnes pratiques et optimisation' },
};

export const TRAINING_STEPS = ['cours', 'exercice', 'correction', 'bilan'] as const;
export type TrainingStep = (typeof TRAINING_STEPS)[number];

export const TRAINING_TRACK_IDS = TRAINING_TRACKS.map((t) => t.id) as [string, ...string[]];

export const findTrack = (id: string) => TRAINING_TRACKS.find((t) => t.id === id);

const STEP_INSTRUCTIONS: Record<TrainingStep, string> = {
  cours:
    "Donne la leçon : 1) l'objectif en une phrase ; 2) l'explication courte avec les termes importants ; 3) une démonstration pas à pas (6 étapes au plus) sur un exemple concret et réaliste du métier du client, avec les noms exacts des menus et des boutons. Choisis un point précis, différent des leçons déjà données dans la conversation.",
  exercice:
    "Propose UN exercice concret que le client peut faire lui-même sur son ordinateur, en lien avec la leçon qui vient d'être donnée, avec le résultat attendu décrit clairement. Ne donne PAS la solution. Termine en disant au client d'écrire ce qu'il a obtenu (ou de joindre une capture d'écran) quand il a essayé.",
  correction:
    "Le client décrit (ou montre sur capture) ce qu'il a fait. Corrige avec bienveillance : dis ce qui est juste, explique précisément l'erreur s'il y en a une et le geste correct. Ne prétends pas voir ce que tu ne vois pas : si la description ou la capture ne suffit pas, demande une précision. Termine par une ligne de verdict : « Réussi », « Presque » ou « À refaire », puis un conseil.",
  bilan:
    "Pose 3 questions courtes à choix multiples (A, B ou C) pour évaluer le niveau du client sur ce qui a été vu jusqu'ici. Ne donne PAS les réponses : le client répondra, puis tu corrigeras à l'étape suivante.",
};

/** Consigne ajoutée au prompt système en mode formation. Tout vient du catalogue : rien du client. */
export function lessonInstruction(track: TrainingTrack, level: 1 | 2 | 3 | 4, step: TrainingStep, index: number): string {
  const lv = TRAINING_LEVELS[level];
  return `\n\nMODE FORMATION. Sujet : ${track.label} — ${track.focus}. Niveau ${level} (${lv.label}) : ${lv.goal}. Leçon n°${index}.\nÉtape demandée : ${step}. ${STEP_INSTRUCTIONS[step]}\nTu t'adresses à un adulte, avec patience, en français simple, sans jargon inutile ; tu restes dans le sujet de formation.`;
}
