-- D9 : deux modes d'assistance (agent IA par défaut, technicien humain en option),
-- 1 assistance offerte par numéro de téléphone, puis abonnement particulier à
-- 10 000 FCFA/mois. Tarifs et durées restent modifiables en admin (RF-41).

-- Mode demandé par le client et mode réellement appliqué à la session
-- (repli sur un technicien tant que l'agent IA n'est pas activé côté serveur).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'humain'
  CHECK (mode IN ('ia', 'humain'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'humain'
  CHECK (mode IN ('ia', 'humain'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS requested_mode TEXT
  CHECK (requested_mode IN ('ia', 'humain'));

-- Abonnement particulier mensuel : une ligne par période payée.
CREATE TABLE IF NOT EXISTS subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_phone  TEXT NOT NULL,
  client_name   TEXT,
  plan_id       TEXT NOT NULL REFERENCES pricing_plans(id),
  order_id      UUID NOT NULL REFERENCES orders(id),
  status        TEXT NOT NULL DEFAULT 'pending_payment'
                  CHECK (status IN ('pending_payment', 'active', 'cancelled')),
  starts_at     TIMESTAMPTZ,
  ends_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_phone ON subscriptions(client_phone, status);

-- Formules : l'assistance offerte et l'assistance couverte par l'abonnement
-- sont à 0 FCFA (la couverture est vérifiée côté serveur, jamais par le client).
INSERT INTO pricing_plans (id, name, segment, price_fcfa, duration_minutes, description, sort_order, metadata) VALUES
  ('assistance_offerte', 'Première assistance offerte', 'particulier', 0, 30,
   'Votre première assistance est offerte : agent IA ou technicien, au choix.', 0,
   '{"freePerPhone":1}'),
  ('abonnement_mensuel', 'Abonnement Assistance', 'particulier', 10000, NULL,
   'Assistances illimitées pendant 30 jours, avec l''agent IA ou un technicien.', 4,
   '{"subscription":true,"periodDays":30}'),
  ('assistance_abonne', 'Assistance (abonné)', 'particulier', 0, 60,
   'Assistance couverte par votre abonnement mensuel.', 5,
   '{"coveredBySubscription":true}')
ON CONFLICT (id) DO NOTHING;
