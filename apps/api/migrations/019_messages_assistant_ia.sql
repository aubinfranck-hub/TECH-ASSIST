-- Le chat IA du site enregistre la réponse de l'assistant dans session_messages, mais la contrainte d'origine (012) n'autorisait
-- que client/technician/system : chaque réponse de l'IA échouait en erreur 500. Elle peut aussi dépasser 1000 caractères (3000 au plus).
ALTER TABLE session_messages DROP CONSTRAINT IF EXISTS session_messages_sender_check;
ALTER TABLE session_messages ADD CONSTRAINT session_messages_sender_check CHECK (sender IN ('client', 'technician', 'system', 'assistant'));
ALTER TABLE session_messages DROP CONSTRAINT IF EXISTS session_messages_body_check;
ALTER TABLE session_messages ADD CONSTRAINT session_messages_body_check CHECK (char_length(body) BETWEEN 1 AND 4000);
