-- Mapping table for restricting MCP clients to specific email accounts
CREATE TABLE IF NOT EXISTS mcp_client_accounts (
  mcp_client_id INTEGER NOT NULL,
  email_account_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (mcp_client_id, email_account_id),
  FOREIGN KEY (mcp_client_id) REFERENCES mcp_clients(id) ON DELETE CASCADE,
  FOREIGN KEY (email_account_id) REFERENCES email_accounts(id) ON DELETE CASCADE
);

-- Index for quickly looking up which accounts a client can access
CREATE INDEX IF NOT EXISTS idx_mcp_client_accounts_client_id ON mcp_client_accounts(mcp_client_id);
-- Index for quickly looking up which clients have access to an account
CREATE INDEX IF NOT EXISTS idx_mcp_client_accounts_account_id ON mcp_client_accounts(email_account_id);
