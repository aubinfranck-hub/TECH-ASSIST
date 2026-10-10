-- D14 : offres à l'usage, version « IA seule / IA + technicien ».
--   500 FCFA  : Assistance IA — l'agent IA analyse et répare avec l'accord du client, SANS technicien humain.
--   2 000 FCFA: Assistance IA + technicien — l'agent d'abord ; un technicien prend le relais si besoin.
--   Entreprise: forfaits selon le NOMBRE DE POSTES ; IA et technicien toujours inclus.
-- Les anciennes portées (diagnostic / fix) disparaissent des offres : les deux forfaits font tout, avec accord du client.
-- Les prix restent modifiables en admin (RF-41) ; cette migration ne les touche pas.

UPDATE pricing_plans SET
  name = 'Assistance IA',
  duration_minutes = 60,
  sort_order = 1,
  description = 'L''agent IA analyse et répare votre PC avec vous, étape par étape, avec votre accord à chaque fois. Sans technicien humain.',
  metadata = metadata || '{"scope":"full","humanIncluded":false}'::jsonb
WHERE id = 'diagnostic_express';

UPDATE pricing_plans SET
  name = 'Assistance IA + technicien',
  duration_minutes = 60,
  sort_order = 2,
  description = 'L''agent IA répare avec vous ; si le problème le demande, un technicien prend le relais.',
  metadata = metadata || '{"scope":"full","humanIncluded":true}'::jsonb
WHERE id = 'assistance_rapide';

-- L'ancien forfait à 5 000 FCFA n'est plus proposé (les commandes déjà passées restent lisibles).
UPDATE pricing_plans SET active = FALSE WHERE id = 'session_maintenance';

-- Complément : un client de l'offre IA seule qui a besoin d'un technicien paie la différence, une fois, pour CETTE assistance.
-- Formule interne : jamais commandable directement (pas de durée) ni listée dans les tarifs.
INSERT INTO pricing_plans (id, name, segment, price_fcfa, duration_minutes, description, sort_order, metadata) VALUES
  ('complement_technicien', 'Ajouter un technicien à mon assistance', 'particulier', 1500, NULL,
   'Complément pour qu''un technicien prenne le relais de l''agent IA sur cette assistance.', 6,
   '{"upgradeHuman":true}')
ON CONFLICT (id) DO NOTHING;

-- Entreprises : l'IA et le technicien sont toujours inclus ; le forfait fixe le nombre de postes (quotas d'assistances inchangés).
UPDATE pricing_plans SET metadata = metadata || '{"aiIncluded":true,"humanIncluded":true}'::jsonb,
  description = 'IA + technicien inclus. Jusqu''à 5 postes, 3 assistances incluses par mois, réponse sous 24h.' WHERE id = 'pme_essentiel';
UPDATE pricing_plans SET metadata = metadata || '{"aiIncluded":true,"humanIncluded":true}'::jsonb,
  description = 'IA + technicien inclus. Jusqu''à 15 postes, 10 assistances incluses par mois, technicien attitré, réponse sous 4h.' WHERE id = 'pme_pro';
UPDATE pricing_plans SET metadata = metadata || '{"aiIncluded":true,"humanIncluded":true}'::jsonb,
  description = 'IA + technicien inclus. Jusqu''à 40 postes, assistances illimitées, technicien attitré, réponse sous 1h, rapport mensuel dirigeant.' WHERE id = 'pme_entreprise';

-- Une session sait si un technicien fait partie de ce qui a été payé (copie du forfait, vérifiée côté serveur).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS human_included BOOLEAN NOT NULL DEFAULT TRUE;

-- Une commande de complément est rattachée à la session qu'elle débloque.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS upgrade_session_id UUID REFERENCES sessions(id);
CREATE INDEX IF NOT EXISTS idx_orders_upgrade_session ON orders(upgrade_session_id) WHERE upgrade_session_id IS NOT NULL;
