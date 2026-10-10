-- D16 : la mémoire d'apprentissage est commune à l'application et au Web.
-- Une session Web n'a pas d'installation physique ; son résultat est donc rattaché
-- directement à la session. Les installations continuent de renseigner app_install_id.
ALTER TABLE learned_procedure_runs ALTER COLUMN app_install_id DROP NOT NULL;
