-- D15 : mémoire de procédures apprises. Un cas inconnu de l'agent est d'abord cherché ici (aucun appel d'IA) ;
-- s'il n'y est pas, une IA compose une procédure à partir du catalogue fermé d'opérations (voir learning/manifest.ts),
-- l'agent la revalide, l'exécute avec l'accord du client, et le résultat est consigné. Une procédure confirmée sur
-- plusieurs postes (ou validée par un administrateur) devient « trusted » : l'IA n'est plus consultée pour ce cas.

CREATE TABLE IF NOT EXISTS learned_procedures (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title              TEXT NOT NULL,
  -- Clés de recherche : mots-clés de la procédure + mots de la demande qui l'a fait naître (voir learning/match.ts).
  tokens             TEXT[] NOT NULL,
  procedure          JSONB NOT NULL,
  proc_hash          TEXT NOT NULL,
  catalog_version    INT NOT NULL,
  -- candidate : composée par l'IA, pas encore confirmée ; trusted : confirmée ; retired : ne doit plus être servie.
  status             TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'trusted', 'retired')),
  -- Validée (ou écartée) par un administrateur : les résultats des clients ne la changent plus d'état.
  locked             BOOLEAN NOT NULL DEFAULT FALSE,
  source             TEXT NOT NULL,
  example_query      TEXT,
  created_by_install UUID REFERENCES app_installs(id) ON DELETE SET NULL,
  uses               INT NOT NULL DEFAULT 0,
  approved_by        TEXT,
  approved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_learned_procedures_hash ON learned_procedures(proc_hash);
CREATE INDEX IF NOT EXISTS idx_learned_procedures_serve ON learned_procedures(status, catalog_version);
CREATE INDEX IF NOT EXISTS idx_learned_procedures_tokens ON learned_procedures USING GIN (tokens);

-- Chaque procédure servie à une session, puis son résultat. Seule une procédure servie peut recevoir un résultat de cette session.
CREATE TABLE IF NOT EXISTS learned_procedure_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  procedure_id   UUID NOT NULL REFERENCES learned_procedures(id) ON DELETE CASCADE,
  session_id     UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  app_install_id UUID NOT NULL REFERENCES app_installs(id) ON DELETE CASCADE,
  -- Mots de la demande de CE client : ajoutés aux clés de la procédure quand elle l'a réellement résolu (elle retrouve alors les formulations voisines).
  query_tokens   TEXT[] NOT NULL DEFAULT '{}',
  result         TEXT NOT NULL DEFAULT 'served' CHECK (result IN ('served', 'resolved', 'not_resolved', 'declined', 'unverified', 'rejected_by_agent')),
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (procedure_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_learned_runs_procedure ON learned_procedure_runs(procedure_id, result);

-- Ce que l'IA n'a pas pu traiter avec le catalogue : la liste des capacités à ajouter, par fréquence.
CREATE TABLE IF NOT EXISTS knowledge_gaps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gap_key       TEXT NOT NULL UNIQUE,
  sample_query  TEXT NOT NULL,
  reason        TEXT NOT NULL,
  occurrences   INT NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'ignored')),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chaque appel à une IA (coût et plafonds) : un fournisseur, un résultat, une durée. Jamais le texte de la demande.
CREATE TABLE IF NOT EXISTS learning_calls (
  id             BIGSERIAL PRIMARY KEY,
  session_id     UUID REFERENCES sessions(id) ON DELETE SET NULL,
  app_install_id UUID REFERENCES app_installs(id) ON DELETE SET NULL,
  provider       TEXT NOT NULL,
  model          TEXT,
  ok             BOOLEAN NOT NULL,
  error          TEXT,
  duration_ms    INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_learning_calls_created ON learning_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_learning_calls_session ON learning_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_learning_calls_install ON learning_calls(app_install_id, created_at);
