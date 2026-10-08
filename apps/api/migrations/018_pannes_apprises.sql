-- Base de pannes du technicien : quand une recherche ne trouve rien dans les ≈500 fiches de départ (assistant/pannesData.ts),
-- une IA (DeepSeek, Gemini ou Claude) rédige une fiche, qui est enregistrée ici. Les recherches suivantes la retrouvent sans
-- nouvel appel d'IA. Une fiche « candidate » est affichée comme proposée par l'IA ; un technicien la confirme ou l'écarte.

CREATE TABLE IF NOT EXISTS learned_pannes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL,
  title         TEXT NOT NULL,
  cause         TEXT NOT NULL DEFAULT '',
  solution      TEXT NOT NULL,
  advanced      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Clés de recherche (voir learning/match.ts) : mots de la fiche + mots de la recherche qui l'a fait naître.
  tokens        TEXT[] NOT NULL,
  -- candidate : rédigée par l'IA, pas encore relue ; trusted : confirmée par un technicien ; retired : écartée.
  status        TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'trusted', 'retired')),
  source        TEXT NOT NULL,
  example_query TEXT,
  created_by    UUID REFERENCES technicians(id) ON DELETE SET NULL,
  reviewed_by   UUID REFERENCES technicians(id) ON DELETE SET NULL,
  uses          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learned_pannes_status ON learned_pannes(status);
CREATE INDEX IF NOT EXISTS idx_learned_pannes_tokens ON learned_pannes USING GIN (tokens);
CREATE UNIQUE INDEX IF NOT EXISTS uq_learned_pannes_title ON learned_pannes (lower(title));
