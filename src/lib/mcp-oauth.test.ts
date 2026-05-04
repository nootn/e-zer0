import { describe, expect, it } from 'vitest';
import { isValidRedirectUri, normalizeDynamicClientRegistration } from './mcp-oauth';

describe('isValidRedirectUri', () => {
    it('rejects redirect URIs containing fragments', () => {
        expect(isValidRedirectUri('https://client.example/callback#fragment')).toBe(false);
        expect(isValidRedirectUri('http://127.0.0.1:43111/callback#local-fragment')).toBe(false);
    });
});

describe('normalizeDynamicClientRegistration', () => {
    it('rejects client names longer than 200 characters', () => {
        expect(() =>
            normalizeDynamicClientRegistration({
                client_name: 'x'.repeat(201),
                redirect_uris: ['https://client.example/callback'],
            })
        ).toThrow('client_name must be 200 characters or fewer');
    });
});
