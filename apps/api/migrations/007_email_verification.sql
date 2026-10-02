-- D9 (suite) : l'assistance offerte est liée à une adresse email VÉRIFIÉE
-- (code à 6 chiffres reçu par email), plus au seul numéro de téléphone.

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

ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_email TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS client_email TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_email_plan ON orders(client_email, plan_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(client_email, status);
