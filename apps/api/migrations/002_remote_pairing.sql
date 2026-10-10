-- Lot L2 — appairage avec le serveur RustDesk auto-hébergé (décision D1).
-- Le mot de passe de connexion RustDesk est chiffré au repos (RS-10) : il
-- n'est déchiffré qu'à la demande du technicien assigné, après consentement
-- contrôle du client (RS-01), et n'est plus lisible une fois la session arrêtée.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS remote_provider TEXT NOT NULL DEFAULT 'rustdesk',
  ADD COLUMN IF NOT EXISTS remote_peer_id TEXT,
  ADD COLUMN IF NOT EXISTS remote_password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS remote_paired_at TIMESTAMPTZ;
