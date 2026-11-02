import { afterEach, describe, expect, it, vi } from 'vitest';
import oauth from './oauth-callback';
import { decrypt } from '../lib/crypto';

vi.mock('../lib/settings', () => ({
    getOAuthCredentials: async () => ({ clientId: 'client', clientSecret: 'secret' }),
}));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe.each([
    ['google', ' https://www.googleapis.com/auth/gmail.readonly\tcalendar.events.readonly  '],
    ['microsoft', ' Mail.Read\tCalendars.Read  '],
] as const)('%s consent scope metadata', (provider, returnedScope) => {
    it.each([
        ['new', returnedScope],
        ['existing', returnedScope],
        ['new', undefined],
        ['existing', undefined],
        ['new', ''],
        ['existing', ''],
    ] as const)('stores only the returned scope for a %s account (scope: %s)', async (account, scope) => {
        const writes: { sql: string; values: unknown[] }[] = [];
        const db = {
            prepare(sql: string) {
                return {
                    bind(...values: unknown[]) {
                        return {
                            async run() {
                                writes.push({ sql, values });
                                return { meta: { changes: account === 'existing' ? 1 : 0 } };
                            },
                        };
                    },
                };
            },
        } as unknown as D1Database;
        const env = { DB: db, ENCRYPTION_KEY: 'ab'.repeat(32), JWT_SECRET: 'test-cookie-signing-secret' };
        const tokenResponse = {
            access_token: 'test-provider-access-token',
            refresh_token: 'test-provider-refresh-token',
            expires_in: 3600,
            ...(scope === undefined ? {} : { scope }),
        };
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json(tokenResponse))
            .mockResolvedValueOnce(Response.json({ email: 'mail@example.com', mail: 'mail@example.com' }));
        vi.stubGlobal('fetch', fetch);
        const logs = [
            vi.spyOn(console, 'log').mockImplementation(() => {}),
            vi.spyOn(console, 'info').mockImplementation(() => {}),
            vi.spyOn(console, 'warn').mockImplementation(() => {}),
            vi.spyOn(console, 'error').mockImplementation(() => {}),
        ];

        const start = await oauth.request(`https://example.com/${provider}/start`, {}, env);
        const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
        const response = await oauth.request(
            `https://example.com/${provider}/callback?code=code&state=${state}`,
            { headers: { Cookie: start.headers.get('Set-Cookie')!.split(';')[0] } },
            env
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Location')).toContain('connected!');
        const update = writes[0];
        expect(update.sql).toContain('granted_scopes = ?');
        expect(update.sql).toContain(`WHERE email_address = ? AND provider = '${provider}'`);
        expect(update.values).toEqual([
            'mail@example.com',
            expect.any(String),
            expect.any(String),
            expect.any(String),
            scope ?? null,
            'mail@example.com',
        ]);
        expect(await decrypt(update.values[1] as string, env.ENCRYPTION_KEY)).toBe(tokenResponse.access_token);
        expect(await decrypt(update.values[2] as string, env.ENCRYPTION_KEY)).toBe(tokenResponse.refresh_token);
        if (account === 'new') {
            expect(writes).toHaveLength(2);
            expect(writes[1].sql).toContain('token_expires_at, granted_scopes)');
            expect(writes[1].sql).toContain(`VALUES (?, ?, '${provider}', ?, ?, ?, ?)`);
            expect(writes[1].values).toEqual([
                'mail@example.com',
                'mail@example.com',
                update.values[1],
                update.values[2],
                update.values[3],
                scope ?? null,
            ]);
        } else {
            expect(writes).toHaveLength(1);
        }
        // Only encrypted account writes: no audit or permission-table mutations.
        expect(writes.every(({ sql }) => /^(UPDATE|INSERT INTO) email_accounts\b/.test(sql))).toBe(true);
        const output = JSON.stringify({
            headers: [...response.headers],
            body: await response.text(),
            logs: logs.flatMap((log) => log.mock.calls),
            writes,
        });
        expect(output).not.toContain(tokenResponse.access_token);
        expect(output).not.toContain(tokenResponse.refresh_token);
    });
});
