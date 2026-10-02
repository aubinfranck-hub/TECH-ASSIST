-- Rattachement d'un PC (programme Windows) à un espace entreprise.
-- L'administrateur de l'entreprise génère un code à usage unique ; le client le saisit dans le programme.
-- Le code n'est jamais stocké en clair (empreinte SHA-256).

CREATE TABLE IF NOT EXISTS company_join_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un poste de l'inventaire peut être rattaché à une installation du programme (une installation = un poste).
ALTER TABLE company_devices ADD COLUMN IF NOT EXISTS app_install_id UUID UNIQUE REFERENCES app_installs(id) ON DELETE SET NULL;
