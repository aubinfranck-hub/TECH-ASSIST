import type { DiagnosticAnswers, DiagnosticResult } from './types.js';

const GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * TA[DECIDER] Le prompt impose ici un jugement honnête de la confiance,
 * contrairement à la version auditée qui forçait une fourchette 75-98% (server.ts:57)
 * quoi que le modèle sache — corrigé.
 */
function buildPrompt(input: DiagnosticAnswers): string {
  const answersText = Object.entries(input.answers)
    .map(([q, a]) => `- ${q} : ${a}`)
    .join('\n');

  return `Tu es un technicien informatique senior. Un client décrit un problème sur ${
    input.platform === 'windows' ? 'un ordinateur Windows' : 'un téléphone/tablette Android'
  }.

Description du client : "${input.problemDescription}"

Réponses au questionnaire :
${answersText || '(aucune réponse complémentaire)'}

Réponds UNIQUEMENT avec un objet JSON valide (sans texte autour, sans balises markdown), avec exactement ces champs :
{
  "summary": "résumé court et honnête du diagnostic en français",
  "likelyCauses": ["cause probable 1", "cause probable 2"],
  "recommendedActions": ["action recommandée 1", "action recommandée 2"],
  "confidence": <entier 0-100, ton vrai niveau de confiance, ne force jamais une valeur entre deux bornes si tu n'es pas sûr>,
  "requiresRemoteSession": <true si une prise en main à distance est utile>,
  "outOfScope": <true si le problème est matériel/physique et ne peut pas être résolu à distance>
}`;
}

export async function runGeminiDiagnostic(input: DiagnosticAnswers): Promise<DiagnosticResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY non configurée');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(input) }] }],
          generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini a répondu ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Réponse Gemini vide');
    }

    const parsed = JSON.parse(text) as Omit<DiagnosticResult, 'source'>;

    return {
      summary: parsed.summary,
      likelyCauses: parsed.likelyCauses ?? [],
      recommendedActions: parsed.recommendedActions ?? [],
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 0))),
      requiresRemoteSession: Boolean(parsed.requiresRemoteSession),
      outOfScope: Boolean(parsed.outOfScope),
      source: 'gemini',
    };
  } finally {
    clearTimeout(timeout);
  }
}
