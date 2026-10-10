-- Lot L1 — schéma initial (RF-32, AU-13)
-- Remplace le stockage provisoire en fichiers JSON par PostgreSQL.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS pricing_plans (
  id            TEXT PRIMARY KEY,           -- ex: 'diagnostic_express'
  name          TEXT NOT NULL,
  segment       TEXT NOT NULL CHECK (segment IN ('particulier', 'pme')),
  price_fcfa    INTEGER NOT NULL CHECK (price_fcfa >= 0),
  duration_minutes INTEGER,                 -- NULL pour les formules sans minuteur (ex: diagnostic)
  description   TEXT NOT NULL DEFAULT '',
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RF-41 : tarifs paramétrables sans redéploiement — les 3 formules particuliers tranchées (D2)
INSERT INTO pricing_plans (id, name, segment, price_fcfa, duration_minutes, description, sort_order) VALUES
  ('diagnostic_express', 'Diagnostic Express', 'particulier', 500, NULL, 'Diagnostic IA complet et plan de réparation, débloqués après paiement.', 1),
  ('assistance_rapide', 'Assistance rapide', 'particulier', 2000, 20, 'Technicien en direct : chat, partage d''écran, contrôle si besoin.', 2),
  ('session_maintenance', 'Session maintenance', 'particulier', 5000, 60, 'Prise en main complète jusqu''à résolution.', 3)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS technicians (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'technician' CHECK (role IN ('technician', 'admin')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  -- TA[MANQUANT][RS-08] 2FA non implémenté (secret TOTP) — à ajouter avant ouverture publique.
  totp_secret   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_phone    TEXT NOT NULL,
  client_name     TEXT,
  plan_id         TEXT NOT NULL REFERENCES pricing_plans(id),
  amount_fcfa     INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_payment'
                    CHECK (status IN ('pending_payment', 'paid', 'refunded', 'cancelled')),
  -- TA[DECIDER][D3] agrégateur Mobile Money non choisi : paiement confirmé à la main (provisoire).
  payment_ref     TEXT,
  paid_by_technician_id UUID REFERENCES technicians(id),
  platform        TEXT CHECK (platform IN ('web', 'windows', 'android')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(client_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS diagnostics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id),
  platform      TEXT NOT NULL,
  answers       JSONB NOT NULL,
  ai_result     JSONB,
  source        TEXT CHECK (source IN ('gemini', 'local_engine')),
  confidence    INTEGER, -- honnête : reflète le vrai résultat, jamais forcé entre deux bornes (AU écart corrigé)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES orders(id),
  session_code      TEXT NOT NULL UNIQUE, -- RS-03 : code à usage unique, 9 chiffres, généré serveur
  status            TEXT NOT NULL DEFAULT 'created'
                       CHECK (status IN ('created', 'waiting_technician', 'active', 'completed', 'expired', 'cancelled')),
  technician_id     UUID REFERENCES technicians(id),
  platform          TEXT NOT NULL CHECK (platform IN ('web', 'windows', 'android')),
  code_expires_at   TIMESTAMPTZ NOT NULL, -- RS-03 : 10 min si non utilisé
  duration_minutes  INTEGER NOT NULL,
  started_at        TIMESTAMPTZ,
  ends_at           TIMESTAMPTZ,
  consent_screen_at TIMESTAMPTZ, -- RS-01 étape 1 : consentement au partage d'écran
  consent_control_at TIMESTAMPTZ, -- RS-01 étape 2 : consentement au contrôle
  stopped_at        TIMESTAMPTZ,
  stopped_by        TEXT CHECK (stopped_by IN ('client', 'technician', 'system', 'timeout')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_technician ON sessions(technician_id);

CREATE TABLE IF NOT EXISTS technician_applications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  id_document_ref TEXT,
  skills        TEXT,
  status        TEXT NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'in_review', 'accepted', 'rejected')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pme_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  computers_count INTEGER,
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visit_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  address       TEXT NOT NULL,
  zone          TEXT,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'scheduled', 'completed', 'cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('client', 'technician', 'admin', 'system')),
  actor_id      TEXT,
  session_id    UUID REFERENCES sessions(id),
  order_id      UUID REFERENCES orders(id),
  action        TEXT NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_logs(session_id);
