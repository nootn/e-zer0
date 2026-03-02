-- App settings for OAuth credentials and other configuration
-- Stored encrypted in D1, managed through the Settings UI

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  encrypted_value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
