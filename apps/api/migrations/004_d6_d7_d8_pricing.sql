-- Décisions D6, D7, D8 (valeurs par défaut raisonnables, modifiables en admin
-- sans redéploiement — RF-41. Voir docs/decisions.md pour la justification).

-- D6 : nom de marque "Tech Assist" conservé (déjà utilisé partout : code,
-- domaine implicite du rapport d'audit, README). Rien à changer en base.

ALTER TABLE pricing_plans DROP CONSTRAINT IF EXISTS pricing_plans_segment_check;
ALTER TABLE pricing_plans ADD CONSTRAINT pricing_plans_segment_check
  CHECK (segment IN ('particulier', 'pme', 'visite'));
ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- D7 : paliers d'abonnement PME au-dessus du forfait d'entrée à 9 900 FCFA/mois.
-- duration_minutes = plafond par défaut d'une session d'assistance couverte par
-- l'abonnement (même sémantique que les formules particuliers, réutilisée pour
-- que l'espace PME s'appuie sur le même moteur de session/minuteur — RP-03).
INSERT INTO pricing_plans (id, name, segment, price_fcfa, duration_minutes, description, sort_order, metadata) VALUES
  ('pme_essentiel', 'PME Essentiel', 'pme', 9900, 60,
   'Jusqu''à 5 postes, 3 assistances incluses par mois, réponse sous 24h.', 10,
   '{"maxDevices":5,"includedAssistances":3,"responseTimeHours":24,"dedicatedTechnician":false,"monthlyReport":false}'),
  ('pme_pro', 'PME Pro', 'pme', 24900, 60,
   'Jusqu''à 15 postes, 10 assistances incluses par mois, technicien attitré, réponse sous 4h.', 11,
   '{"maxDevices":15,"includedAssistances":10,"responseTimeHours":4,"dedicatedTechnician":true,"monthlyReport":false}'),
  ('pme_entreprise', 'PME Entreprise', 'pme', 49900, 60,
   'Jusqu''à 40 postes, assistances illimitées, technicien attitré, réponse sous 1h, rapport mensuel dirigeant.', 12,
   '{"maxDevices":40,"includedAssistances":null,"responseTimeHours":1,"dedicatedTechnician":true,"monthlyReport":true}')
ON CONFLICT (id) DO NOTHING;

-- D8 : forfaits fixes par type d'intervention plutôt qu'un devis systématique
-- (plus simple à comprendre pour un lancement) ; au-delà de 10 postes, devis.
INSERT INTO pricing_plans (id, name, segment, price_fcfa, duration_minutes, description, sort_order, metadata) VALUES
  ('visite_reseau', 'Diagnostic réseau / WiFi', 'visite', 5000, NULL,
   'Zone Abidjan intra-muros ; +2 000 FCFA hors zone.', 20, '{"zone":"abidjan"}'),
  ('visite_reinstallation', 'Réinstallation système', 'visite', 10000, NULL,
   'Sauvegarde des données avant réinstallation, avec accord écrit (RV-07).', 21, '{}'),
  ('visite_materiel', 'Installation matériel / imprimante', 'visite', 5000, NULL,
   '', 22, '{}'),
  ('visite_parc', 'Mise en service d''un parc (PME)', 'visite', 0, NULL,
   'Sur devis à partir de 10 postes.', 23, '{"onQuote":true}')
ON CONFLICT (id) DO NOTHING;
