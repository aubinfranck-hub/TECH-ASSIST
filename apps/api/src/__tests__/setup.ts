process.env.DATABASE_URL ??= 'postgres://tech_assist:tech_assist@localhost:5432/tech_assist_test';
process.env.JWT_SECRET ??= 'test-secret';
process.env.SESSION_SECRETS_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.NODE_ENV = 'test';
