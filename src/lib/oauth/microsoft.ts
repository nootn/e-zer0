// Microsoft OAuth 2.0 helpers (Azure AD v2)

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

const MS_SCOPES = [
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/Mail.ReadWrite',
    'https://graph.microsoft.com/User.Read',
    'offline_access',
].join(' ');

export function getMicrosoftAuthUrl(clientId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: MS_SCOPES,
        response_mode: 'query',
        state,
    });
    return `${MS_AUTH_URL}?${params}`;
}

export async function exchangeMicrosoftCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const res = await fetch(MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Microsoft token exchange failed: ${err}`);
    }

    return res.json();
}

export async function refreshMicrosoftToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
    const res = await fetch(MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            scope: MS_SCOPES,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Microsoft token refresh failed: ${err}`);
    }

    return res.json();
}

export async function getMicrosoftUserEmail(accessToken: string): Promise<string> {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) throw new Error('Failed to get Microsoft user info');
    const info = (await res.json()) as { mail?: string; userPrincipalName: string };
    return info.mail || info.userPrincipalName;
}
