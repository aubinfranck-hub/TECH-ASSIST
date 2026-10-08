-- Applications technicien (Windows, Android) : chaque installation reçoit un « jeton d'appareil » longue durée (30 jours), propre à CET
-- appareil et révocable. Le serveur le revérifie à chaque requête : technicien désactivé ou appareil révoqué = accès coupé tout de suite.
CREATE TABLE IF NOT EXISTS technician_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  label         TEXT NOT NULL DEFAULT '',
  platform      TEXT NOT NULL CHECK (platform IN ('windows', 'android', 'web')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_technician_devices_tech ON technician_devices(technician_id) WHERE revoked_at IS NULL;
