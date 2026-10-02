/** Résultat d'une commande exécutée sur l'appareil du client. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Seul point d'accès de l'agent à la machine : il exécute un script PowerShell
 * écrit PAR NOUS. L'agent n'exécute jamais de commande libre venue d'un modèle IA
 * ni du serveur : voir la liste blanche d'actions dans chaque compétence.
 */
export interface CommandRunner {
  runPowerShell(script: string, options?: { timeoutMs?: number }): Promise<CommandResult>;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Une action que l'agent peut proposer. Rien ne s'exécute sans l'accord explicite du client. */
export interface Action {
  id: string;
  /** Titre court affiché au client. */
  title: string;
  /** Ce que l'action change, en mots simples. */
  explanation: string;
  /** Nécessite que l'agent soit lancé en administrateur. */
  requiresAdmin: boolean;
  /**
   * true : commande ou cmdlet standard et documentée ; false : mécanisme non documenté ou fragile
   * (interface COM interne…). Dans les deux cas, pas encore essayée sur une vraie machine.
   */
  verified: boolean;
  /** Consigne affichée au client une fois l'action lancée (ex. « suivez la fenêtre qui s'ouvre »). */
  followUp?: string;
  /** « sensitive » : modification difficile à défaire (pile réseau, composants Windows, pilote…) ; un point de restauration est créé d'abord. */
  risk?: 'normal' | 'sensitive';
  /** Action lancée juste avant celle-ci, après l'accord du client (ex. point de restauration). */
  prepare?: Action;
  /** Ne prend effet qu'après un redémarrage : l'agent ne peut pas vérifier tout de suite et propose de redémarrer. */
  needsReboot?: boolean;
  run(runner: CommandRunner): Promise<ActionResult>;
}

export interface Diagnosis {
  /** Phrase lisible résumant l'état constaté. */
  summary: string;
  /** Codes des problèmes détectés (pour le journal). */
  problems: string[];
  /** Actions proposées, dans l'ordre. */
  actions: Action[];
  /** Conseils pour ce que l'agent ne peut pas faire seul (brancher un casque…). */
  advice: string[];
  /** Rien d'anormal côté système. */
  healthy: boolean;
  /** Le problème dépasse l'agent : un technicien doit prendre la main. */
  needsHuman: boolean;
}

export interface Skill {
  id: string;
  title: string;
  /** Question posée au client pour confirmer que c'est réglé (l'agent ne peut pas le constater seul). */
  verifyQuestion: string;
  /** Lecture seule : observe l'état de l'appareil, ne modifie rien. */
  diagnose(runner: CommandRunner): Promise<Diagnosis>;
}

export type EventType =
  | 'diagnosed'
  | 'action_proposed'
  | 'action_approved'
  | 'action_declined'
  | 'action_done'
  | 'action_failed'
  | 'verified'
  | 'escalated'
  | 'user_request';

export interface AgentEvent {
  type: EventType;
  skill: string;
  action?: string;
  message?: string;
  details?: Record<string, unknown>;
}

/** Compte rendu de chaque étape (journal côté serveur, console locale). */
export interface Reporter {
  event(event: AgentEvent): Promise<void>;
}

/** Dialogue avec le client : l'agent ne fait rien de modifiant sans son « oui ». */
export interface Ui {
  info(message: string): void;
  confirmAction(action: Action): Promise<boolean>;
  /** « Entendez-vous du son maintenant ? » — l'agent ne peut pas l'entendre lui-même. */
  confirmFixed(question: string): Promise<boolean>;
}

/** Interface de conversation : en plus des confirmations, l'utilisateur écrit et choisit. */
export interface ConversationUi extends Ui {
  /** Question libre ; null si l'utilisateur ferme la conversation. */
  ask(prompt: string): Promise<string | null>;
  /** Choix dans une liste (index), null s'il renonce. */
  choose(question: string, options: string[]): Promise<number | null>;
  /** Le client a demandé un technicien depuis l'interface (bouton dédié). */
  wasHandedOff?(): boolean;
}
