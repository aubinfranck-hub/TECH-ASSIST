-- RS-08 : authentification à deux facteurs (TOTP) pour les comptes techniciens/admin.
ALTER TABLE technicians
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
-- totp_secret existe déjà (migration 001) : c'est le secret confirmé et actif.

-- RP-01 à RP-09 : espace entreprise PME.
CREATE TABLE IF NOT EXISTS companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  email           TEXT,
  subscription_plan_id TEXT REFERENCES pricing_plans(id),
  subscription_status  TEXT NOT NULL DEFAULT 'trial'
                    CHECK (subscription_status IN ('trial', 'active', 'suspended', 'cancelled')),
  assigned_technician_id UUID REFERENCES technicians(id), -- RT-04 : technicien attitré PME
  monthly_assistance_quota INTEGER, -- RP-06 : assistances incluses / mois
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RP-08 : deux rôles côté entreprise (administrateur / employé).
CREATE TABLE IF NOT EXISTS company_users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  phone           TEXT NOT NULL,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('admin', 'employee')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RP-04 : consentement écrit du dirigeant à l'installation de l'agent permanent.
CREATE TABLE IF NOT EXISTS company_consents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  signed_by_company_user_id UUID NOT NULL REFERENCES company_users(id),
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RP-05 : inventaire et santé du parc (postes de l'entreprise).
CREATE TABLE IF NOT EXISTS company_devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_name     TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('windows', 'android')),
  disk_free_percent    INTEGER,
  memory_used_percent   INTEGER,
  antivirus_ok    BOOLEAN,
  os_up_to_date   BOOLEAN,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_company_devices_name UNIQUE (company_id, device_name)
);

-- RP-03 : demandes d'aide PME (bouton "Demander de l'aide" sur le poste),
-- distinctes des sessions particuliers pour la priorité et le technicien attitré.
CREATE TABLE IF NOT EXISTS company_help_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_user_id UUID NOT NULL REFERENCES company_users(id),
  device_id       UUID REFERENCES company_devices(id),
  description     TEXT NOT NULL,
  priority        TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'assigned', 'in_progress', 'resolved', 'cancelled')),
  session_id      UUID REFERENCES sessions(id), -- lié à une session d'assistance une fois prise en charge
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_company_help_requests_status ON company_help_requests(status);
CREATE INDEX IF NOT EXISTS idx_company_devices_company ON company_devices(company_id);
