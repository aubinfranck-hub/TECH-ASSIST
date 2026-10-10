-- Les jetons d'une installation peuvent être invalidés en réenregistrant
-- l'application. Un jeton volé devient alors inutilisable sans toucher aux
-- autres installations.
ALTER TABLE app_installs
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
