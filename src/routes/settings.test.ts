import { expect, it } from 'vitest';
import settings from './settings';
import { getGoogleAuthUrl } from '../lib/oauth/google';
import { getMicrosoftAuthUrl } from '../lib/oauth/microsoft';

it('renders provider instructions matching requested scopes and separate calendar consent', async () => {
    const db = {
        prepare() {
            return {
                bind() {
                    return this;
                },
                first: async () => null,
            };
        },
    } as unknown as D1Database;
    const response = await settings.request('https://example.com/', {}, { DB: db });
    expect(response.status).toBe(200);
    const html = await response.text();
    const googleScopes = new URL(getGoogleAuthUrl('client', 'https://example.com/callback', 'state')).searchParams
        .get('scope')!
        .split(' ');
    const microsoftScopes = new URL(getMicrosoftAuthUrl('client', 'https://example.com/callback', 'state')).searchParams
        .get('scope')!
        .split(' ');
    for (const scope of googleScopes) expect(html).toContain(scope);
    for (const scope of microsoftScopes) expect(html).toContain(scope.replace('https://graph.microsoft.com/', ''));
    expect(html).toContain('calendar-json.googleapis.com');
    expect(html).toContain('Do not disconnect first');
    expect(html).toContain('Calendar grants are separate from email grants and default to off');
    expect(html).toContain('Calendar (read-only) in the account table and click Save Changes');
    expect(html).toContain('saved as drafts only');
    expect(html).toContain('Create custom MCP server');
    expect(html).toContain('https://example.com/mcp');
    expect(html).toContain('Refresh tools');
    expect(html).toContain('View details');
    expect(html).toContain('plugin&#39;s Permission control');
    expect(html).toContain('ChatGPT tool approvals do not grant additional mailbox or calendar access');
    expect(html).toContain('start a new chat and select the plugin again');
    expect(html).toContain('email read does not verify calendar access, Outlook access or write actions');
    expect(html).toContain('Testing authorisations expire after 7 days');
    expect(html).toContain('Publish app');
    expect(html).toContain('fewer than 100 people');
    expect(html).toContain('Production is not an email allowlist');
    expect(html).toContain('Public MCP registration does not grant mailbox access');
    expect(html).toContain('background refresh also runs for unused active accounts');
    expect(html).toContain('support.google.com/cloud/answer/13464323');
});
