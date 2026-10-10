export interface DiagnosticAnswers {
  platform: 'windows' | 'android';
  /** Description libre du problème par le client, en français. */
  problemDescription: string;
  /** Réponses au questionnaire guidé (clé = id de question). */
  answers: Record<string, string>;
}

export interface DiagnosticResult {
  summary: string;
  likelyCauses: string[];
  recommendedActions: string[];
  /** 0-100, reflète le vrai niveau de confiance — jamais forcé dans une fourchette (AU écart corrigé). */
  confidence: number;
  requiresRemoteSession: boolean;
  outOfScope: boolean;
  source: 'gemini' | 'local_engine';
}
