-- Create oauth_auth_codes table for the Authorization Code flow
CREATE TABLE IF NOT EXISTS oauth_auth_codes (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT,
    code_challenge_method TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    user_id INTEGER NOT NULL,
    FOREIGN KEY(client_id) REFERENCES mcp_clients(client_id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

-- Index for quick lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_lookup ON oauth_auth_codes(id, client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_auth_codes_expiry ON oauth_auth_codes(expires_at);
