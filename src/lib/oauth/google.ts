// Google OAuth 2.0 helpers

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const GMAIL_SCOPES = ['https://mail.google.com/', 'https://www.googleapis.com/auth/userinfo.email'].join(' ');

export function getGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GMAIL_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state,
    });
    return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function exchangeGoogleCode(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
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
        throw new Error(`Google token exchange failed: ${err}`);
    }

    return res.json();
}

export async function refreshGoogleToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
): Promise<{ access_token: string; expires_in: number }> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google token refresh failed: ${err}`);
    }

    return res.json();
}

export async function getGoogleUserEmail(accessToken: string): Promise<string> {
    const res = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) throw new Error('Failed to get Google user info');
    const info = (await res.json()) as { email: string };
    return info.email;
}
