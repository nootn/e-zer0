-- Store OAuth client metadata needed for dynamic client registration and redirect URI validation
ALTER TABLE mcp_clients ADD COLUMN redirect_uris TEXT;
ALTER TABLE mcp_clients ADD COLUMN grant_types TEXT;
ALTER TABLE mcp_clients ADD COLUMN token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_post';
