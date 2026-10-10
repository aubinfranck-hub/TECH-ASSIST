-- Diagnostic à distance d'un PC du parc : demandé par l'administrateur de l'entreprise, lecture seule.
-- Le programme sur le PC l'affiche à son utilisateur, qui accepte ou refuse ; seul un résumé est renvoyé.
CREATE TABLE IF NOT EXISTS company_diagnostic_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id     UUID NOT NULL REFERENCES company_devices(id) ON DELETE CASCADE,
  requested_by  UUID,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'declined')),
  summary       TEXT,
  worst         TEXT CHECK (worst IN ('critical', 'fixable', 'watch', 'ok', 'unknown')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at   TIMESTAMPTZ
);
-- Une seule demande en attente par poste.
CREATE UNIQUE INDEX IF NOT EXISTS uq_diag_req_pending ON company_diagnostic_requests(device_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_diag_req_company ON company_diagnostic_requests(company_id, created_at DESC);
