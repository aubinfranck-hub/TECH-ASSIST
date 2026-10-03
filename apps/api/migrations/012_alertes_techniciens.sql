-- Passage de main à un technicien : alerte automatique des techniciens de permanence, et discussion avec le client.
--   on_duty / alert_email : le technicien choisit s'il est de permanence et où recevoir l'alerte (en plus des notifications du téléphone).
--   human_requested_at    : date de la demande de technicien ; une seule alerte par demande.
--   technician_push_subscriptions : un abonnement de notification par appareil (téléphone ou ordinateur) du technicien.
--   session_messages      : discussion client <-> technicien, affichée dans la fenêtre de l'agent et dans la console technicien.
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS on_duty BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS alert_email TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS human_requested_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS technician_push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_technician ON technician_push_subscriptions(technician_id);

CREATE TABLE IF NOT EXISTS session_messages (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender        TEXT NOT NULL CHECK (sender IN ('client', 'technician', 'system')),
  technician_id UUID REFERENCES technicians(id),
  body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_session_messages_session ON session_messages(session_id, id);
