-- MCP agent client credentials
CREATE TABLE IF NOT EXISTS mcp_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL UNIQUE,
  secret_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_clients_client_id ON mcp_clients(client_id);
