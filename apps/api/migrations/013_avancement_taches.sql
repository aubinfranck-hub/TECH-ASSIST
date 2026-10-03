-- Avancement de l'intervention de l'agent, visible en direct par le technicien :
--   task_progress    : état des tâches (en cours, terminées, à venir, avec leurs durées habituelles), renvoyé par l'agent à chaque changement.
--   task_progress_at : dernière nouvelle de l'agent (l'agent en donne aussi pendant les longues tâches : un silence prolongé veut dire PC éteint ou hors ligne).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS task_progress JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS task_progress_at TIMESTAMPTZ;
