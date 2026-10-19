-- Claim a filter definition before POST: concurrent/uncertain creates must reconcile first.
CREATE TABLE IF NOT EXISTS filter_write_intents (
    account_id INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
    definition TEXT NOT NULL,
    owner TEXT NOT NULL,
    provider_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account_id, definition)
);
