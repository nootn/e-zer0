CREATE TABLE mcp_client_calendar_accounts (
    mcp_client_id INTEGER NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
    email_account_id INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (mcp_client_id, email_account_id)
);
