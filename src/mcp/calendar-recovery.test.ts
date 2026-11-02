import { afterEach, expect, it, vi } from 'vitest';
import { encrypt, decrypt } from '../lib/crypto';
import { listCalendars, getCalendarEvents } from './tools';
import type { Env } from '../types';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function fixture(provider: 'google' | 'microsoft' = 'google', expiry = Date.now() + 3600_000) {
    const key = '01'.repeat(32);
    const account = {
        id: 1,
        provider,
        status: 'active',
        encrypted_access_token: await encrypt('old-token', key),
        encrypted_refresh_token: await encrypt('refresh-token', key),
        token_expires_at: new Date(expiry).toISOString(),
        granted_scopes: 'original-scopes',
    };
    const credentials = { client_id: await encrypt('client', key), client_secret: await encrypt('secret', key) };
    const writes: { sql: string; values: unknown[] }[] = [];
    let permitted = true;
    const db = {
        prepare(sql: string) {
            let values: unknown[] = [];
            return {
                bind(...args: unknown[]) {
                    values = args;
                    return this;
                },
                async first() {
                    if (sql.includes('mcp_client_calendar_accounts')) return permitted ? { permitted: 1 } : null;
                    if (sql.includes('app_settings'))
                        return {
                            encrypted_value: String(values[0]).endsWith('CLIENT_ID')
                                ? credentials.client_id
                                : credentials.client_secret,
                        };
                    if (sql.includes('email_accounts')) return { ...account };
                    throw new Error('Unexpected query');
                },
                async run() {
                    writes.push({ sql, values });
                    if (sql.includes('UPDATE email_accounts')) {
                        account.encrypted_access_token = String(values[0]);
                        if (values[1] !== null) account.encrypted_refresh_token = String(values[1]);
                        account.token_expires_at = String(values[2]);
                        if (values[3] !== null) account.granted_scopes = String(values[3]);
                    }
                    return { meta: { changes: 1 } };
                },
            };
        },
    };
    return {
        env: { DB: db, ENCRYPTION_KEY: key } as unknown as Env,
        account,
        writes,
        deny() {
            permitted = false;
        },
    };
}

it.each(['google', 'microsoft'] as const)(
    'refreshes a near-expiry %s token before reading without broadening consent',
    async (provider) => {
        const f = await fixture(provider, Date.now() + 30_000);
        const calls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string, init: RequestInit) => {
                calls.push(url);
                if (url.includes('/token')) {
                    expect(init.method).toBe('POST');
                    const params = new URLSearchParams(init.body as string);
                    expect(params.get('grant_type')).toBe('refresh_token');
                    expect(params.has('scope')).toBe(false);
                    return Response.json({
                        access_token: 'fresh-token',
                        expires_in: 3600,
                        scope: 'returned-scopes',
                        ...(provider === 'microsoft' ? { refresh_token: 'rotated-refresh' } : {}),
                    });
                }
                expect(init.headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
                expect(init.method || 'GET').toBe('GET');
                return Response.json(provider === 'google' ? { items: [] } : { value: [] });
            })
        );
        const result = await listCalendars(f.env, 'client', 1);
        expect(result.calendars).toEqual([]);
        expect(result).toHaveProperty('access.refreshed', true);
        expect(calls.filter((url) => url.includes('/token'))).toHaveLength(1);
        expect(f.account.granted_scopes).toBe('returned-scopes');
        expect(await decrypt(f.account.encrypted_refresh_token, f.env.ENCRYPTION_KEY!)).toBe(
            provider === 'microsoft' ? 'rotated-refresh' : 'refresh-token'
        );
        expect(f.writes).toHaveLength(1);
        expect(f.writes[0].sql).not.toContain('mcp_client');
    }
);

it('recovers once from a mid-run 401 using the existing refresh token', async () => {
    const f = await fixture();
    let reads = 0,
        refreshes = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
            if (url.includes('/token')) {
                refreshes++;
                return Response.json({ access_token: 'fresh-token', expires_in: 3600 });
            }
            reads++;
            if (reads === 1) return Response.json({ error: { errors: [{ reason: 'authError' }] } }, { status: 401 });
            expect(init.headers).toMatchObject({ Authorization: 'Bearer fresh-token' });
            return Response.json({ items: [] });
        })
    );
    const result = await getCalendarEvents(
        f.env,
        'client',
        1,
        'secondary',
        '2026-10-01T00:00:00Z',
        '2026-10-02T00:00:00Z',
        1
    );
    expect(result.events).toEqual([]);
    expect(reads).toBe(2);
    expect(refreshes).toBe(1);
    expect(f.account.granted_scopes).toBe('original-scopes');
});

it('coalesces simultaneous near-expiry refreshes within one isolate', async () => {
    const f = await fixture('google', Date.now() - 1000);
    let refreshes = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url.includes('/token')) {
                refreshes++;
                await Promise.resolve();
                return Response.json({ access_token: 'fresh', expires_in: 3600 });
            }
            return Response.json({ items: [] });
        })
    );
    const results = await Promise.all([listCalendars(f.env, 'client', 1), listCalendars(f.env, 'client', 1)]);
    expect(results.every((result) => result.access.refreshed)).toBe(true);
    expect(refreshes).toBe(1);
    expect(f.writes).toHaveLength(1);
});

it('retains a rotated Google refresh token when the provider supplies one', async () => {
    const f = await fixture('google', Date.now() - 1000);
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
            url.includes('/token')
                ? Response.json({ access_token: 'fresh', refresh_token: 'google-rotated', expires_in: 3600 })
                : Response.json({ items: [] })
        )
    );
    await listCalendars(f.env, 'client', 1);
    expect(await decrypt(f.account.encrypted_refresh_token, f.env.ENCRYPTION_KEY!)).toBe('google-rotated');
});

it('uses a freshly reconnected account when an older refresh returns invalid_grant', async () => {
    const f = await fixture('google', Date.now() - 1000);
    const reconnected = await encrypt('reconnected-token', f.env.ENCRYPTION_KEY!);
    let reads = 0,
        refreshes = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
            if (url.includes('/token')) {
                refreshes++;
                f.account.encrypted_access_token = reconnected;
                f.account.token_expires_at = new Date(Date.now() + 3600_000).toISOString();
                return Response.json({ error: 'invalid_grant' }, { status: 400 });
            }
            reads++;
            expect(init.headers).toMatchObject({ Authorization: 'Bearer reconnected-token' });
            return Response.json({ items: [] });
        })
    );
    const result = await listCalendars(f.env, 'client', 1);
    expect(result.calendars).toEqual([]);
    expect(refreshes).toBe(1);
    expect(reads).toBe(1);
    expect(f.writes).toHaveLength(0);
});

it('does not refresh twice when a proactively refreshed token is still rejected', async () => {
    const f = await fixture('google', Date.now() - 1000);
    let refreshes = 0,
        reads = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            if (url.includes('/token')) {
                refreshes++;
                return Response.json({ access_token: 'fresh', expires_in: 3600 });
            }
            reads++;
            return new Response(null, { status: 401 });
        })
    );
    await expect(listCalendars(f.env, 'client', 1)).rejects.toMatchObject({ code: 'provider_token_invalid' });
    expect(refreshes).toBe(1);
    expect(reads).toBe(1);
});

it.each(['google', 'microsoft'] as const)(
    'retains %s token-endpoint rate limiting and retry delay',
    async (provider) => {
        const f = await fixture(provider, Date.now() - 1000);
        let requests = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                requests++;
                return Response.json(
                    { error: 'temporarily_unavailable', error_description: 'private-secret' },
                    { status: 429, headers: { 'Retry-After': '120' } }
                );
            })
        );
        const error = await listCalendars(f.env, 'client', 1).catch((e: unknown) => e);
        expect(error).toMatchObject({
            code: 'provider_rate_limited',
            httpStatus: 429,
            provider,
            retryAfterSeconds: 120,
        });
        expect(String(error)).not.toContain('private-secret');
        expect(requests).toBe(1);
        expect(f.writes).toHaveLength(0);
    }
);

it.each(['denied', 'inactive', 'forbidden', 'invalid_grant', 'repeated_401', 'revoked_during_refresh'] as const)(
    'bounds recovery and preserves permissions/status for %s',
    async (scenario) => {
        const f = await fixture();
        if (scenario === 'denied') f.deny();
        if (scenario === 'inactive') f.account.status = 'expired';
        let reads = 0,
            refreshes = 0;
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (url.includes('/token')) {
                    refreshes++;
                    if (scenario === 'invalid_grant')
                        return Response.json(
                            { error: 'invalid_grant', error_description: 'private-secret' },
                            { status: 400 }
                        );
                    if (scenario === 'revoked_during_refresh') f.deny();
                    return Response.json({ access_token: 'fresh-token', expires_in: 3600 });
                }
                reads++;
                return Response.json(
                    {
                        error: {
                            errors: [{ reason: scenario === 'forbidden' ? 'insufficientPermissions' : 'authError' }],
                        },
                    },
                    { status: scenario === 'forbidden' ? 403 : 401 }
                );
            })
        );
        const error = await listCalendars(f.env, 'client', 1).catch((e: unknown) => e);
        const codes = {
            denied: 'calendar_grant_missing',
            inactive: 'calendar_account_inactive',
            forbidden: 'provider_scope_missing',
            invalid_grant: 'provider_reauthentication_required',
            repeated_401: 'provider_token_invalid',
            revoked_during_refresh: 'calendar_grant_missing',
        };
        expect(error).toMatchObject({ code: codes[scenario] });
        expect(String(error)).not.toContain('private-secret');
        expect(refreshes).toBe(['denied', 'inactive', 'forbidden'].includes(scenario) ? 0 : 1);
        expect(reads).toBe(['denied', 'inactive'].includes(scenario) ? 0 : scenario === 'repeated_401' ? 2 : 1);
        expect(f.account.status).toBe(scenario === 'inactive' ? 'expired' : 'active');
        expect(
            f.writes.every((write) => !write.sql.includes('mcp_client') && !write.sql.includes("status = 'error'"))
        ).toBe(true);
    }
);
