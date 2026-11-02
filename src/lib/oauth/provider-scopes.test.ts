import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeGoogleCode, refreshGoogleToken } from './google';
import { exchangeMicrosoftCode, refreshMicrosoftToken } from './microsoft';

afterEach(() => vi.unstubAllGlobals());

describe.each([
    ['Google exchange', () => exchangeGoogleCode('code', 'client', 'secret', 'https://example.com/callback')],
    ['Microsoft exchange', () => exchangeMicrosoftCode('code', 'client', 'secret', 'https://example.com/callback')],
    ['Google refresh', () => refreshGoogleToken('refresh', 'client', 'secret')],
    ['Microsoft refresh', () => refreshMicrosoftToken('refresh', 'client', 'secret')],
] as const)('%s scope response', (_name, requestTokens) => {
    it.each([' Mail.Read\tcalendar.events.readonly  ', undefined])(
        'preserves the raw provider scope without filling in omitted scopes (%s)',
        async (scope) => {
            vi.stubGlobal(
                'fetch',
                vi.fn(async () =>
                    Response.json({
                        access_token: 'test-access',
                        refresh_token: 'test-refresh',
                        expires_in: 3600,
                        ...(scope === undefined ? {} : { scope }),
                    })
                )
            );
            const result = await requestTokens();
            expect(result.scope).toBe(scope);
            expect(Object.hasOwn(result, 'scope')).toBe(scope !== undefined);
        }
    );
});
