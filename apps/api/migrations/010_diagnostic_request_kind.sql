-- Une demande peut être un diagnostic (lecture seule) ou une réparation (« Réparer mon PC », avec accord de l'utilisateur pour chaque action).
ALTER TABLE company_diagnostic_requests ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'diagnostic' CHECK (kind IN ('diagnostic', 'repair'));
