import { afterEach, expect, it, vi } from 'vitest';
import { listProviderCalendars } from './calendar';

afterEach(() => vi.unstubAllGlobals());

it.each([
    ['google', 401, 'authError', 'provider_token_invalid'],
    ['google', 403, 'insufficientPermissions', 'provider_scope_missing'],
    ['google', 403, 'rateLimitExceeded', 'provider_rate_limited'],
    ['google', 404, 'notFound', 'provider_calendar_unavailable'],
    ['microsoft', 401, 'InvalidAuthenticationToken', 'provider_token_invalid'],
    ['microsoft', 403, 'ErrorAccessDenied', 'provider_calendar_forbidden'],
] as const)('classifies %s %s %s without leaking provider content', async (provider, status, reason, code) => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
            Response.json(
                {
                    error: { code: reason, message: 'private-event-content token=secret', errors: [{ reason }] },
                },
                { status }
            )
        )
    );
    const error = await listProviderCalendars(provider, 'secret').catch((e: unknown) => e);
    expect(error).toMatchObject({ code, httpStatus: status, provider, providerReason: reason });
    expect(String(error)).not.toContain('private-event-content');
    expect(String(error)).not.toContain('secret');
    if (status === 401) expect(String(error)).not.toContain('consent is missing');
});

it('handles empty provider error bodies and does not echo unknown reasons', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(null, { status: 503 }))
    );
    await expect(listProviderCalendars('google', 'secret')).rejects.toMatchObject({
        code: 'provider_calendar_failed',
        httpStatus: 503,
    });
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json({ error: { errors: [{ reason: 'private-secret' }] } }, { status: 403 }))
    );
    const error = await listProviderCalendars('google', 'secret').catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'provider_calendar_forbidden' });
    expect(JSON.stringify(error)).not.toContain('private-secret');
});

it.each(['45', new Date(Date.now() + 120_000).toUTCString()])(
    'preserves a safe retry delay from %s',
    async (retryAfter) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': retryAfter } }))
        );
        const error = (await listProviderCalendars('google', 'secret').catch((e: unknown) => e)) as {
            retryAfterSeconds: number;
        };
        expect(error.retryAfterSeconds).toBeGreaterThan(0);
        expect(error.retryAfterSeconds).toBeLessThanOrEqual(120);
        if (retryAfter === '45') expect(error.retryAfterSeconds).toBe(45);
    }
);
