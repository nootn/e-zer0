import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../../index';
import accounts from '../../routes/accounts';
import type { EmailAccount, Env } from '../../types';
import { refreshAccountToken } from './refresh';

vi.mock('./refresh', () => ({ refreshAccountToken: vi.fn() }));

const databases: DatabaseSync[] = [];
beforeEach(() => {
    vi.mocked(refreshAccountToken).mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('Unexpected network request');
    });
});
afterEach(() => {
    databases.splice(0).forEach((db) => db.close());
    vi.restoreAllMocks();
});

function fixture(access: string | null = 'encrypted-old-access', refresh: string | null = 'encrypted-old-refresh') {
    const sqlite = new DatabaseSync(':memory:');
    databases.push(sqlite);
    sqlite.exec(readFileSync(new URL('../../../migrations/0002_email_accounts.sql', import.meta.url), 'utf8'));
    sqlite
        .prepare(
            `INSERT INTO email_accounts
        (id, alias, email_address, provider, encrypted_access_token, encrypted_refresh_token, token_expires_at, updated_at)
        VALUES (1, 'Test', 'test@example.com', 'google', ?, ?, '2000-01-01T00:00:00Z', 'original-timestamp')`
        )
        .run(access, refresh);
    sqlite.exec(`
        INSERT INTO email_accounts (id, alias, email_address, provider, encrypted_access_token, encrypted_refresh_token)
        VALUES (2, 'Other', 'other@example.com', 'google', 'encrypted-old-access', 'encrypted-old-refresh');
        CREATE TABLE mcp_client_accounts (mcp_client_id INTEGER, email_account_id INTEGER);
        CREATE TABLE mcp_client_calendar_accounts (mcp_client_id INTEGER, email_account_id INTEGER);
        INSERT INTO mcp_client_accounts VALUES (11, 1);
        INSERT INTO mcp_client_calendar_accounts VALUES (11, 1);
    `);
    const db = {
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
                async all() {
                    return { results: sqlite.prepare(sql).all(...values) };
                },
                async run() {
                    return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } };
                },
            };
        },
    } as unknown as D1Database;
    return {
        sqlite,
        db,
        env: { DB: db, ENCRYPTION_KEY: 'ab'.repeat(32) } as Env,
        account: () => sqlite.prepare('SELECT * FROM email_accounts WHERE id = 1').get() as unknown as EmailAccount,
        other: () => sqlite.prepare('SELECT * FROM email_accounts WHERE id = 2').get(),
        grants: () => ({
            email: sqlite.prepare('SELECT * FROM mcp_client_accounts').all(),
            calendar: sqlite.prepare('SELECT * FROM mcp_client_calendar_accounts').all(),
        }),
    };
}

const callers = [
    {
        name: 'cron',
        status: 'expired',
        async run(env: Env) {
            await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);
        },
    },
    {
        name: 'manual',
        status: 'error',
        async run(env: Env) {
            const response = await accounts.request('/1/refresh', { method: 'POST' }, env);
            expect(response.status).toBe(302);
            expect(response.headers.get('location')).toContain('error=Refresh%20failed');
        },
    },
];

it.each(
    callers.flatMap((caller) =>
        ['reconnect', 'revoked', 'nonrotating-success', 'refresh-rotated', 'unchanged'].map((race) => ({
            ...caller,
            race,
        }))
    )
)('$name handles an in-flight refresh failure after $race', async ({ run, status, race }) => {
    const f = fixture();
    const original = f.account();
    const other = f.other();
    const grants = f.grants();
    let current = original;
    vi.mocked(refreshAccountToken).mockImplementationOnce(async (_env, snapshot) => {
        expect(snapshot).toEqual(original);
        if (race === 'reconnect')
            f.sqlite.exec(
                "UPDATE email_accounts SET encrypted_refresh_token = 'encrypted-new-refresh', encrypted_access_token = 'encrypted-new-access', updated_at = 'concurrent-timestamp' WHERE id = 1"
            );
        if (race === 'revoked')
            f.sqlite.exec(
                "UPDATE email_accounts SET status = 'revoked', updated_at = 'concurrent-timestamp' WHERE id = 1"
            );
        if (race === 'nonrotating-success')
            f.sqlite.exec(
                "UPDATE email_accounts SET encrypted_access_token = 'encrypted-new-access', updated_at = 'concurrent-timestamp' WHERE id = 1"
            );
        if (race === 'refresh-rotated')
            f.sqlite.exec(
                "UPDATE email_accounts SET encrypted_refresh_token = 'encrypted-new-refresh', updated_at = 'concurrent-timestamp' WHERE id = 1"
            );
        current = f.account();
        throw new Error('Refresh rejected');
    });
    await run(f.env);
    expect(refreshAccountToken).toHaveBeenCalledExactlyOnceWith(f.env, original);
    expect(f.account(), race).toEqual(
        race === 'unchanged' ? { ...original, status, updated_at: expect.any(String) } : current
    );
    if (race === 'unchanged') expect(f.account().updated_at).not.toBe(original.updated_at);
    expect(f.other()).toEqual(other);
    expect(f.grants()).toEqual(grants);
    expect(fetch).not.toHaveBeenCalled();
});

it.each([
    [null, null],
    [null, 'encrypted-old-refresh'],
    ['encrypted-old-access', null],
])('manual failure matches unchanged nullable tokens (%s, %s)', async (access, refresh) => {
    const f = fixture(access, refresh);
    const original = f.account();
    vi.mocked(refreshAccountToken).mockRejectedValueOnce(new Error('Refresh rejected'));
    await callers[1].run(f.env);
    expect(f.account()).toEqual({ ...original, status: 'error', updated_at: expect.any(String) });
});
