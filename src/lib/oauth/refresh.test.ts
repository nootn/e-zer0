import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { encrypt, decrypt } from '../crypto';
import { refreshAccountToken } from './refresh';
import type { Env, EmailAccount } from '../../types';

afterEach(() => vi.unstubAllGlobals());

it.each(['unchanged', 'revoked', 'rotated', 'new_access', 'scope_omitted', 'scope_empty'] as const)(
    'executes the refresh compare-and-set and scope retention in SQLite (%s)',
    async (scenario) => {
        const sqlite = new DatabaseSync(':memory:');
        const key = 'ab'.repeat(32);
        const oldAccess = await encrypt('old-access', key);
        const oldRefresh = await encrypt('old-refresh', key);
        const newerRefresh = await encrypt('newer-refresh', key);
        const newerAccess = await encrypt('newer-access', key);
        try {
            sqlite.exec(`CREATE TABLE email_accounts (
                id INTEGER PRIMARY KEY, provider TEXT, status TEXT, encrypted_access_token TEXT,
                encrypted_refresh_token TEXT, token_expires_at TEXT, granted_scopes TEXT, updated_at TEXT);
                CREATE TABLE app_settings (key TEXT PRIMARY KEY, encrypted_value TEXT);
                CREATE TABLE mcp_client_accounts (mcp_client_id INTEGER, email_account_id INTEGER);
                CREATE TABLE mcp_client_calendar_accounts (mcp_client_id INTEGER, email_account_id INTEGER);
                INSERT INTO mcp_client_accounts VALUES (1,1);
                INSERT INTO mcp_client_calendar_accounts VALUES (1,1);`);
            sqlite
                .prepare('INSERT INTO email_accounts VALUES (1, ?, ?, ?, ?, ?, ?, NULL)')
                .run('microsoft', 'active', oldAccess, oldRefresh, '2026-01-01T00:00:00Z', 'original-scopes');
            for (const name of ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'])
                sqlite
                    .prepare('INSERT INTO app_settings VALUES (?, ?)')
                    .run(name, await encrypt('test-credential', key));
            const snapshot = sqlite.prepare('SELECT * FROM email_accounts WHERE id=1').get() as unknown as EmailAccount;
            const env = {
                ENCRYPTION_KEY: key,
                DB: {
                    prepare(sql: string) {
                        let values: (string | number | null)[] = [];
                        return {
                            bind(...args: (string | number | null)[]) {
                                values = args;
                                return this;
                            },
                            async first() {
                                return sqlite.prepare(sql).get(...values) ?? null;
                            },
                            async run() {
                                return { meta: sqlite.prepare(sql).run(...values) };
                            },
                        };
                    },
                },
            } as unknown as Env;
            vi.stubGlobal(
                'fetch',
                vi.fn(async (_url: string, init: RequestInit) => {
                    expect(new URLSearchParams(init.body as string).has('scope')).toBe(false);
                    if (scenario === 'revoked') sqlite.exec("UPDATE email_accounts SET status='revoked' WHERE id=1");
                    if (scenario === 'rotated')
                        sqlite
                            .prepare('UPDATE email_accounts SET encrypted_refresh_token=? WHERE id=1')
                            .run(newerRefresh);
                    if (scenario === 'new_access')
                        sqlite
                            .prepare('UPDATE email_accounts SET encrypted_access_token=? WHERE id=1')
                            .run(newerAccess);
                    return Response.json({
                        access_token: 'new-access',
                        refresh_token: 'rotated-response',
                        expires_in: 3600,
                        ...(scenario === 'scope_omitted'
                            ? {}
                            : { scope: scenario === 'scope_empty' ? '' : 'provider-scopes' }),
                    });
                })
            );
            await refreshAccountToken(env, snapshot);
            const after = sqlite.prepare('SELECT * FROM email_accounts WHERE id=1').get() as unknown as EmailAccount;
            if (scenario === 'revoked' || scenario === 'rotated' || scenario === 'new_access') {
                expect(after.encrypted_access_token).toBe(scenario === 'new_access' ? newerAccess : oldAccess);
                expect(after.granted_scopes).toBe('original-scopes');
                expect(after.status).toBe(scenario === 'revoked' ? 'revoked' : 'active');
                expect(after.encrypted_refresh_token).toBe(scenario === 'rotated' ? newerRefresh : oldRefresh);
            } else {
                expect(await decrypt(after.encrypted_access_token!, key)).toBe('new-access');
                expect(await decrypt(after.encrypted_refresh_token!, key)).toBe('rotated-response');
                expect(after.granted_scopes).toBe(
                    scenario === 'scope_omitted'
                        ? 'original-scopes'
                        : scenario === 'scope_empty'
                          ? ''
                          : 'provider-scopes'
                );
            }
            expect(sqlite.prepare('SELECT * FROM mcp_client_accounts').all()).toEqual([
                { mcp_client_id: 1, email_account_id: 1 },
            ]);
            expect(sqlite.prepare('SELECT * FROM mcp_client_calendar_accounts').all()).toEqual([
                { mcp_client_id: 1, email_account_id: 1 },
            ]);
        } finally {
            sqlite.close();
        }
    }
);
