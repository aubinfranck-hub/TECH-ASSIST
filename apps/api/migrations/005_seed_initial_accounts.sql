-- Amorçage du tout premier compte admin et du tout premier compte technicien.
-- N'insère rien si un compte existe déjà (WHERE NOT EXISTS), donc sans danger
-- à rejouer et sans effet sur une base qui a déjà été initialisée autrement
-- (ex. via POST /api/auth/technician/bootstrap-team).
INSERT INTO technicians (full_name, phone, username, password_hash, role)
SELECT 'Administrateur', '+2250700000001', 'admin', '$2a$12$BOh8GU1qe8.UsPnY3WnQ9OPTnXaWrM50WJJZdKkwLK1P5BKpz8gKe', 'admin'
WHERE NOT EXISTS (SELECT 1 FROM technicians);

INSERT INTO technicians (full_name, phone, username, password_hash, role)
SELECT 'Technicien', '+2250700000002', 'technicien1', '$2a$12$vJBczV40Zj17RCWn/GzRj.c2ExyF66wJZkBCbj0sHpb1vD7SNm9O.', 'technician'
WHERE NOT EXISTS (SELECT 1 FROM technicians WHERE username = 'technicien1');
