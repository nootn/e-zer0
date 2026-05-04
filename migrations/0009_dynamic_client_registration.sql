-- Store OAuth client metadata needed for dynamic client registration and redirect URI validation
ALTER TABLE mcp_clients ADD COLUMN redirect_uris TEXT;
ALTER TABLE mcp_clients ADD COLUMN grant_types TEXT;
ALTER TABLE mcp_clients ADD COLUMN token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_post';

-- Legacy pre-DCR agents are confidential client-credentials clients with no browser redirect flow.
UPDATE mcp_clients
SET redirect_uris = '[]'
WHERE redirect_uris IS NULL;

UPDATE mcp_clients
SET grant_types = '["client_credentials"]'
WHERE grant_types IS NULL;
