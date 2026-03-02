// Cloudflare Worker bindings
export interface Env {
    // D1 SQL database
    DB: D1Database;

    // Vectorize index for semantic email search (optional — unavailable in local dev)
    VECTOR_INDEX?: VectorizeIndex;

    // Workers AI for generating embeddings (optional — unavailable in local dev)
    AI?: Ai;

    // Auto-generated secrets (stored in D1 app_settings, optionally overridden via wrangler secret)
    ENCRYPTION_KEY?: string;
    JWT_SECRET?: string;

    // Rate Limiting KV
    RATE_LIMITER: KVNamespace;
}

// Database row types
export interface AdminUser {
    id: number;
    username: string;
    password_hash: string;
    salt: string;
    created_at: string;
}

export interface Session {
    id: number;
    user_id: number;
    token: string;
    expires_at: string;
    created_at: string;
}

export interface EmailAccount {
    id: number;
    alias: string;
    email_address: string;
    provider: 'google' | 'microsoft';
    encrypted_access_token: string | null;
    encrypted_refresh_token: string | null;
    token_expires_at: string | null;
    status: 'active' | 'expired' | 'error' | 'revoked';
    created_at: string;
    updated_at: string;
}

export interface McpClient {
    id: number;
    name: string;
    client_id: string;
    secret_hash: string;
    salt: string;
    is_active: number;
    last_used_at: string | null;
    created_at: string;
    // UI convenience field (not strictly mapped 1:1 to row)
    allowed_accounts?: number[];
}

export interface McpClientAccount {
    mcp_client_id: number;
    email_account_id: number;
    created_at: string;
}

export interface AuditLog {
    id: number;
    client_id: string;
    client_name: string | null;
    action: string;
    target: string | null;
    details: string | null;
    success: number;
    error_message: string | null;
    created_at: string;
}
