import { describe, expect, it } from 'vitest';
import app from '../app';
import { generateSalt, hashPassword } from '../lib/crypto';

interface TestClientRecord {
    id: number;
    name: string;
    client_id: string;
    secret_hash: string;
    salt: string;
    is_active: number;
    last_used_at: string | null;
    created_at: string;
    redirect_uris?: string | null;
    grant_types?: string | null;
    token_endpoint_auth_method?: string | null;
}

interface TestAuthCodeRecord {
    id: string;
    client_id: string;
    redirect_uri: string;
    code_challenge: string | null;
    code_challenge_method: string | null;
    expires_at: string;
    user_id: number;
}

class FakeKvNamespace {
    private readonly store = new Map<string, string>();

    async get(key: string) {
        return this.store.get(key) ?? null;
    }

    async put(key: string, value: string) {
        this.store.set(key, value);
    }

    async delete(key: string) {
        this.store.delete(key);
    }
}

class FakeD1Database {
    private nextClientId = 100;

    constructor(
        readonly clients: TestClientRecord[] = [],
        readonly authCodes: TestAuthCodeRecord[] = []
    ) {}

    prepare(sql: string) {
        return new FakePreparedStatement(this, sql);
    }

    insertClient(
        record: Omit<TestClientRecord, 'id' | 'created_at' | 'last_used_at' | 'is_active'> & Partial<TestClientRecord>
    ) {
        const row: TestClientRecord = {
            id: this.nextClientId++,
            is_active: 1,
            last_used_at: null,
            created_at: new Date().toISOString(),
            redirect_uris: null,
            grant_types: null,
            token_endpoint_auth_method: 'client_secret_post',
            ...record,
        };
        this.clients.push(row);
        return row;
    }
}

class FakePreparedStatement {
    private boundValues: unknown[] = [];

    constructor(
        private readonly db: FakeD1Database,
        private readonly sql: string
    ) {}

    bind(...values: unknown[]) {
        this.boundValues = values;
        return this;
    }

    async first<T>() {
        if (this.sql.includes('SELECT COUNT(*) as count FROM admin_users')) {
            return { count: 1 } as T;
        }

        if (this.sql.includes('SELECT * FROM mcp_clients WHERE client_id = ? AND is_active = 1')) {
            const clientId = this.boundValues[0];
            return (this.db.clients.find((client) => client.client_id === clientId && client.is_active === 1) ??
                null) as T;
        }

        if (this.sql.includes('SELECT is_active FROM mcp_clients WHERE client_id = ?')) {
            const clientId = this.boundValues[0];
            const client = this.db.clients.find((row) => row.client_id === clientId);
            return (client ? { is_active: client.is_active } : null) as T;
        }

        if (
            this.sql.includes('SELECT * FROM oauth_auth_codes WHERE id = ? AND client_id = ? AND expires_at > datetime')
        ) {
            const [codeId, clientId] = this.boundValues;
            const now = Date.now();
            const row =
                this.db.authCodes.find(
                    (code) =>
                        code.id === codeId && code.client_id === clientId && new Date(code.expires_at).getTime() > now
                ) ?? null;
            return row as T;
        }

        throw new Error(`Unhandled first() SQL in test fake: ${this.sql}`);
    }

    async run() {
        if (this.sql.includes('UPDATE mcp_clients SET last_used_at = datetime(?) WHERE id = ?')) {
            const [, id] = this.boundValues;
            const client = this.db.clients.find((row) => row.id === id);
            if (client) {
                client.last_used_at = new Date().toISOString();
            }
            return { success: true };
        }

        if (this.sql.includes('DELETE FROM oauth_auth_codes WHERE id = ?')) {
            const codeId = this.boundValues[0];
            const index = this.db.authCodes.findIndex((row) => row.id === codeId);
            if (index >= 0) {
                this.db.authCodes.splice(index, 1);
            }
            return { success: true };
        }

        if (this.sql.includes('INSERT INTO mcp_clients')) {
            const [name, clientId, secretHash, salt, redirectUris, grantTypes, tokenEndpointAuthMethod] =
                this.boundValues;
            const row = this.db.insertClient({
                name: name as string,
                client_id: clientId as string,
                secret_hash: secretHash as string,
                salt: salt as string,
                redirect_uris: (redirectUris as string | null) ?? null,
                grant_types: (grantTypes as string | null) ?? null,
                token_endpoint_auth_method: (tokenEndpointAuthMethod as string | null) ?? 'client_secret_post',
            });
            return { success: true, meta: { last_row_id: row.id } };
        }

        throw new Error(`Unhandled run() SQL in test fake: ${this.sql}`);
    }

    async all<T>() {
        throw new Error(`Unhandled all() SQL in test fake: ${this.sql}`);
    }
}

async function createEnv(clients: TestClientRecord[] = [], authCodes: TestAuthCodeRecord[] = []) {
    return {
        DB: new FakeD1Database(clients, authCodes) as unknown as D1Database,
        RATE_LIMITER: new FakeKvNamespace() as unknown as KVNamespace,
        JWT_SECRET: 'test-jwt-secret',
    };
}

describe('MCP OAuth integration routes', () => {
    it('advertises a registration endpoint and refresh token support in metadata', async () => {
        const response = await app.fetch(
            new Request('https://example.com/.well-known/oauth-authorization-server'),
            await createEnv()
        );

        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body.registration_endpoint).toBe('https://example.com/register');
        expect(body.grant_types_supported).toContain('refresh_token');
    });

    it('registers a public OAuth client for Codex login', async () => {
        const env = await createEnv();

        const response = await app.fetch(
            new Request('https://example.com/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    client_name: 'OpenAI Codex',
                    redirect_uris: ['http://127.0.0.1:43111/callback'],
                    grant_types: ['authorization_code', 'refresh_token'],
                    token_endpoint_auth_method: 'none',
                }),
            }),
            env
        );

        expect(response.status).toBe(201);

        const body = await response.json();
        expect(body.client_id).toMatch(/^ez_/);
        expect(body.token_endpoint_auth_method).toBe('none');
        expect(body.redirect_uris).toEqual(['http://127.0.0.1:43111/callback']);
        expect(body.client_secret).toBeUndefined();
    });

    it('rejects authorization-code exchange when redirect_uri does not match the original authorization request', async () => {
        const env = await createEnv(
            [
                {
                    id: 7,
                    name: 'OpenAI Codex',
                    client_id: 'ez_public',
                    secret_hash: '',
                    salt: '',
                    is_active: 1,
                    last_used_at: null,
                    created_at: new Date().toISOString(),
                    redirect_uris: JSON.stringify(['http://127.0.0.1:43111/callback']),
                    grant_types: JSON.stringify(['authorization_code', 'refresh_token']),
                    token_endpoint_auth_method: 'none',
                },
            ],
            [
                {
                    id: 'auth-code-1',
                    client_id: 'ez_public',
                    redirect_uri: 'http://127.0.0.1:43111/callback',
                    code_challenge: null,
                    code_challenge_method: null,
                    expires_at: new Date(Date.now() + 60_000).toISOString(),
                    user_id: 1,
                },
            ]
        );

        const response = await app.fetch(
            new Request('https://example.com/mcp/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'authorization_code',
                    client_id: 'ez_public',
                    code: 'auth-code-1',
                    redirect_uri: 'http://127.0.0.1:49999/other',
                }),
            }),
            env
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ error: 'invalid_grant' });
    });

    it('issues 30-day access tokens for client credentials', async () => {
        const salt = generateSalt();
        const secretHash = await hashPassword('super-secret', salt);

        const env = await createEnv([
            {
                id: 9,
                name: 'Legacy Agent',
                client_id: 'ez_legacy',
                secret_hash: secretHash,
                salt,
                is_active: 1,
                last_used_at: null,
                created_at: new Date().toISOString(),
                redirect_uris: null,
                grant_types: null,
                token_endpoint_auth_method: 'client_secret_post',
            },
        ]);

        const response = await app.fetch(
            new Request('https://example.com/mcp/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'client_credentials',
                    client_id: 'ez_legacy',
                    client_secret: 'super-secret',
                }),
            }),
            env
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ expires_in: 60 * 60 * 24 * 30 });
    });
});
