-- D16 : techniciens partenaires (viewer) et rémunération des techniciens à l'assistance.
-- Toutes les instructions sont rejouables (les tests rejouent les migrations à chaque lancement).

-- 1. Comptes partenaires : même table que les techniciens, rôle distinct (aucune route technicien ne les accepte).
ALTER TABLE technicians DROP CONSTRAINT IF EXISTS technicians_role_check;
ALTER TABLE technicians ADD CONSTRAINT technicians_role_check CHECK (role IN ('technician', 'admin', 'partner'));

ALTER TABLE technicians
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS payout_phone TEXT,
  ADD COLUMN IF NOT EXISTS payout_operator TEXT,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES technicians(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE technicians DROP CONSTRAINT IF EXISTS technicians_approval_status_check;
ALTER TABLE technicians ADD CONSTRAINT technicians_approval_status_check CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE technicians DROP CONSTRAINT IF EXISTS technicians_payout_operator_check;
ALTER TABLE technicians ADD CONSTRAINT technicians_payout_operator_check
  CHECK (payout_operator IS NULL OR payout_operator IN ('wave', 'orange', 'mtn', 'moov', 'djamo'));

-- 2. Session « viewer » : le partenaire se connecte au poste de SON client ; 3 minutes gratuites, puis 500 FCFA la session.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'assistance',
  ADD COLUMN IF NOT EXISTS viewer_label TEXT,
  -- Début de la fenêtre gratuite : première remise des identifiants de connexion au partenaire.
  ADD COLUMN IF NOT EXISTS viewer_connected_at TIMESTAMPTZ,
  -- Durée gratuite accordée à cette session (0 si ce poste en a déjà bénéficié récemment).
  ADD COLUMN IF NOT EXISTS viewer_free_seconds INTEGER;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_kind_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_kind_check CHECK (kind IN ('assistance', 'viewer'));
CREATE INDEX IF NOT EXISTS idx_sessions_viewer ON sessions(technician_id, created_at DESC) WHERE kind = 'viewer';

-- Formule interne : jamais commandable (pas de durée, donc refusée par toutes les routes de commande) ni listée dans les tarifs ;
-- le prix reste modifiable en admin. La durée maximale d'une session partenaire est dans ses métadonnées.
INSERT INTO pricing_plans (id, name, segment, price_fcfa, duration_minutes, description, sort_order, metadata) VALUES
  ('viewer_session', 'Session partenaire (accès à distance)', 'particulier', 500, NULL,
   'Connexion d''un technicien partenaire au poste de son client : 3 minutes gratuites, puis 500 FCFA la session.', 9,
   '{"viewerSession":true,"maxMinutes":120}')
ON CONFLICT (id) DO NOTHING;

-- 3. Rémunération : grille par type d'assistance, gains par assistance terminée, versements.
CREATE TABLE IF NOT EXISTS technician_pay_rates (
  kind        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  amount_fcfa INTEGER NOT NULL CHECK (amount_fcfa >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Montants de départ à confirmer par l'administrateur (modifiables sans redéploiement).
INSERT INTO technician_pay_rates (kind, label, amount_fcfa) VALUES
  ('ia_technicien', 'Assistance IA + technicien', 1000),
  ('complement', 'Technicien ajouté à une assistance IA', 1000),
  ('entreprise', 'Assistance d''une entreprise', 1000)
ON CONFLICT (kind) DO NOTHING;

CREATE TABLE IF NOT EXISTS technician_payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id),
  amount_fcfa   INTEGER NOT NULL CHECK (amount_fcfa > 0),
  reference     TEXT NOT NULL,
  note          TEXT,
  paid_by       UUID REFERENCES technicians(id) ON DELETE SET NULL,
  paid_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_technician_payouts_tech ON technician_payouts(technician_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS technician_earnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id),
  -- Une seule rémunération par assistance : le crédit à la fin de l'assistance est rejouable sans risque de doublon.
  session_id    UUID NOT NULL UNIQUE REFERENCES sessions(id),
  kind          TEXT NOT NULL REFERENCES technician_pay_rates(kind),
  amount_fcfa   INTEGER NOT NULL CHECK (amount_fcfa >= 0),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cancelled')),
  -- Ce que l'administrateur voit pour valider : messages écrits, accès à distance consulté, durée, commande confirmée par le technicien lui-même…
  evidence      JSONB NOT NULL DEFAULT '{}'::jsonb,
  note          TEXT,
  approved_by   UUID REFERENCES technicians(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ,
  payout_id     UUID REFERENCES technician_payouts(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_technician_earnings_tech ON technician_earnings(technician_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_technician_earnings_status ON technician_earnings(status, created_at DESC);
