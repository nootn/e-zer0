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

    // Cloudflare Turnstile (optional — omit to disable bot protection in local dev)
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
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
    redirect_uris?: string | null;
    grant_types?: string | null;
    token_endpoint_auth_method?: 'none' | 'client_secret_post' | null;
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

export interface OauthAuthCode {
    id: string; // The code itself
    client_id: string;
    redirect_uri: string;
    code_challenge: string | null;
    code_challenge_method: string | null;
    created_at: string;
    expires_at: string;
    user_id: number;
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
export interface DraftReplyResult {
    draft_id: string;
    message_id: string;
}

export interface GmailReplyMetadata {
    threadId?: string;
    payload?: { headers?: { name: string; value: string }[] };
}

export interface GmailMessageMetadata {
    id: string;
    threadId: string;
    payload: { headers: { name: string; value: string }[] };
    snippet?: string;
    labelIds?: string[];
}

export interface EmailRuleConditions {
    from?: string[];
    to?: string[];
    subject?: string[];
    body?: string[];
    query?: string;
    negatedQuery?: string;
}

export interface EmailRuleActions {
    addLabels?: string[];
    removeLabels?: string[];
    archive?: boolean;
    markAsRead?: boolean;
    delete?: boolean;
    moveToFolder?: string;
}

export interface GmailMimePart {
    mimeType?: string;
    filename?: string;
    headers?: { name: string; value: string }[];
    body?: { data?: string; attachmentId?: string; size?: number };
    parts?: GmailMimePart[];
}

export interface EmailChangePreview {
    id: string;
    addLabelIds: string[];
    removeLabelIds: string[];
    reason?: string;
    before: string[];
    fingerprint: string;
}

export interface CalendarSummary {
    id: string;
    name: string;
    primary: boolean;
    time_zone?: string;
}

export interface CalendarEvent {
    id: string;
    title: string;
    description: string;
    location: string;
    start: string;
    end: string;
    time_zone?: string;
    all_day: boolean;
    cancelled: boolean;
}

export interface GoogleCalendarEvent {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { date?: string; dateTime?: string; timeZone?: string };
    end?: { date?: string; dateTime?: string; timeZone?: string };
    status?: string;
}

export interface GoogleCalendarSummary {
    id: string;
    summary?: string;
    primary?: boolean;
    timeZone?: string;
}

export interface MicrosoftCalendarSummary {
    id: string;
    name?: string;
    isDefaultCalendar?: boolean;
}

export interface CalendarPage<T> {
    items?: T[];
    value?: T[];
    nextPageToken?: string;
    '@odata.nextLink'?: string;
    timeZone?: string;
}

export interface MicrosoftCalendarEvent {
    originalStartTimeZone?: string;
    id: string;
    subject?: string;
    body?: { content?: string };
    location?: { displayName?: string };
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    isAllDay?: boolean;
    isCancelled?: boolean;
}
