import { describe, expect, it } from 'vitest';

import { getGoogleAuthUrl } from './google';

describe('getGoogleAuthUrl', () => {
    it('requests least-privilege Gmail scopes instead of full mailbox access', () => {
        const url = new URL(getGoogleAuthUrl('client-id', 'https://example.com/callback', 'state'));
        const scopes = url.searchParams.get('scope')?.split(' ') ?? [];

        expect(scopes).toContain('https://www.googleapis.com/auth/gmail.readonly');
        expect(scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
        expect(scopes).toContain('https://www.googleapis.com/auth/gmail.settings.basic');
        expect(scopes).not.toContain('https://mail.google.com/');
    });
});
