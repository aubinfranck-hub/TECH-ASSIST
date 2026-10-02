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
  /** false : écrite d'après la documentation mais pas encore validée sur une vraie machine. */
  verified: boolean;
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
  | 'escalated';

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
