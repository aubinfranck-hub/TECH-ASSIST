-- D9 (suite) : tout part de l'application installée. Chaque installation est
-- enregistrée en base (identifiant d'installation + adresse email vérifiée par
-- code), et c'est la base qui retient si l'assistance offerte est déjà utilisée.
-- Le site n'est que le miroir de ces données.

CREATE TABLE IF NOT EXISTS email_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,           -- adresse normalisée (voir utils/email.ts)
  code_hash   TEXT NOT NULL,           -- HMAC du code : le code lui-même n'est jamais stocké
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email, created_at DESC);

CREATE TABLE IF NOT EXISTS app_installs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  install_id          TEXT NOT NULL UNIQUE,   -- identifiant généré par l'application au 1er lancement
  platform            TEXT NOT NULL CHECK (platform IN ('windows', 'android')),
  hardware_hash       TEXT,                   -- empreinte de l'appareil (si l'application la fournit)
  client_email        TEXT NOT NULL,          -- adresse vérifiée par code
  client_phone        TEXT NOT NULL,          -- contact pour le technicien
  client_name         TEXT,
  free_offer_used_at  TIMESTAMPTZ,            -- non NULL : l'assistance offerte a été utilisée
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_installs_email ON app_installs(client_email);
CREATE INDEX IF NOT EXISTS idx_app_installs_hw ON app_installs(hardware_hash) WHERE hardware_hash IS NOT NULL;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS app_install_id UUID REFERENCES app_installs(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS client_email TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(client_email, status);
