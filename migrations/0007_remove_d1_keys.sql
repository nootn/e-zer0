-- Remove deprecated root keys (ENCRYPTION_KEY, JWT_SECRET) from the database
-- These are now managed exclusively via Cloudflare Secrets / .dev.vars

DELETE FROM app_settings WHERE key IN ('ENCRYPTION_KEY', 'JWT_SECRET', '_ENCRYPTION_KEY', '_JWT_SECRET');
