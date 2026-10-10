-- Modèle commercial : le particulier paie un forfait par assistance (500 / 2 000 / 5 000 FCFA),
-- l'entreprise un contrat mensuel. Chaque forfait a une portée (scope) appliquée par l'agent :
--   diagnostic : analyse et explications, aucune modification
--   fix        : dépannage d'un problème précis, avec accord du client
--   full       : intervention complète jusqu'à résolution
UPDATE pricing_plans SET duration_minutes = 15, metadata = metadata || '{"scope":"diagnostic"}'::jsonb,
  name = 'Diagnostic', description = 'Nous analysons votre problème et vous expliquons quoi faire. Rien n''est modifié.'
  WHERE id = 'diagnostic_express';
UPDATE pricing_plans SET metadata = metadata || '{"scope":"fix"}'::jsonb,
  name = 'Dépannage', description = 'Un problème précis réglé avec vous : Windows, Office, Outlook, imprimante, Wi-Fi…'
  WHERE id = 'assistance_rapide';
UPDATE pricing_plans SET metadata = metadata || '{"scope":"full"}'::jsonb,
  name = 'Intervention complète', description = 'Prise en main complète jusqu''à résolution, avec un technicien si nécessaire.'
  WHERE id = 'session_maintenance';

-- Une commande ne démarre qu'une seule session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_order_unique ON sessions(order_id);
