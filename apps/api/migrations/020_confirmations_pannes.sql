-- Apprentissage automatique : une fiche rédigée par l'IA (« candidate ») devient « de confiance » quand DEUX clients différents
-- confirment que la réponse construite avec elle a réglé leur problème. `confirmed_by` garde les installations qui l'ont confirmée
-- (une installation ne compte qu'une fois). Les fiches issues de texte de clients ne sont jamais promues automatiquement.
ALTER TABLE learned_pannes ADD COLUMN IF NOT EXISTS confirmed_by UUID[] NOT NULL DEFAULT '{}';
