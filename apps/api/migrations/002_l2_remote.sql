-- Lot L2 : liaison RustDesk.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS remote_peer_id TEXT,
  ADD COLUMN IF NOT EXISTS remote_password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS remote_paired_at TIMESTAMPTZ;
