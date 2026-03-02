import { Hono } from 'hono';
import { setSignedCookie, getSignedCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../types';
import { encrypt } from '../lib/crypto';
import { getGoogleAuthUrl, exchangeGoogleCode, getGoogleUserEmail } from '../lib/oauth/google';
import { getMicrosoftAuthUrl, exchangeMicrosoftCode, getMicrosoftUserEmail } from '../lib/oauth/microsoft';
import { generateToken } from '../lib/crypto';
import { getOAuthCredentials } from '../lib/settings';

const oauth = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

// ── Helper to build redirect URIs ───────────────────────
function getBaseUrl(req: Request): string {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
}

// ── Google OAuth ────────────────────────────────────────

oauth.get('/google/start', async (c) => {
    const creds = await getOAuthCredentials(c.env.DB, 'google', c.env.ENCRYPTION_KEY!);
    if (!creds) {
        return c.redirect(
            '/accounts?error=' +
                encodeURIComponent(
                    'Google OAuth not configured. Go to Settings to add your Google Client ID and Secret.'
                )
        );
    }

    const state = generateToken();
    const redirectUri = `${getBaseUrl(c.req.raw)}/oauth/google/callback`;
    const authUrl = getGoogleAuthUrl(creds.clientId, redirectUri, state);

    // Set a short-lived signed cookie to prevent OAuth CSRF (finding #5)
    await setSignedCookie(c, 'oauth_state', state, c.env.JWT_SECRET!, {
        path: '/',
        secure: true,
        httpOnly: true,
        maxAge: 600, // 10 minutes
        sameSite: 'Lax', // Must be lax for cross-site redirect to work
    });

    return c.redirect(authUrl);
});

oauth.get('/google/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error || !code) {
        return c.redirect('/accounts?error=' + encodeURIComponent('Google OAuth was denied or failed.'));
    }

    // Verify OAuth CSRF State (finding #5)
    const storedState = await getSignedCookie(c, c.env.JWT_SECRET!, 'oauth_state');
    deleteCookie(c, 'oauth_state');

    if (!storedState || storedState !== state) {
        return c.redirect('/accounts?error=' + encodeURIComponent('Security verification failed. Please try again.'));
    }

    try {
        const creds = await getOAuthCredentials(c.env.DB, 'google', c.env.ENCRYPTION_KEY!);
        if (!creds) throw new Error('Google OAuth credentials not found');

        const redirectUri = `${getBaseUrl(c.req.raw)}/oauth/google/callback`;
        const tokens = await exchangeGoogleCode(code, creds.clientId, creds.clientSecret, redirectUri);
        const email = await getGoogleUserEmail(tokens.access_token);

        const encryptedAccess = await encrypt(tokens.access_token, c.env.ENCRYPTION_KEY!);
        const encryptedRefresh = await encrypt(tokens.refresh_token, c.env.ENCRYPTION_KEY!);
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

        await c.env.DB.prepare(
            `INSERT INTO email_accounts (alias, email_address, provider, encrypted_access_token, encrypted_refresh_token, token_expires_at)
         VALUES (?, ?, 'google', ?, ?, ?)`
        )
            .bind(email, email, encryptedAccess, encryptedRefresh, expiresAt)
            .run();

        return c.redirect('/accounts?message=' + encodeURIComponent(`Gmail account ${email} connected!`));
    } catch (err: any) {
        console.error('Google OAuth Error:', err);
        return c.redirect('/accounts?error=' + encodeURIComponent('Google OAuth failed. Please try again.'));
    }
});

// ── Microsoft OAuth ─────────────────────────────────────

oauth.get('/microsoft/start', async (c) => {
    const creds = await getOAuthCredentials(c.env.DB, 'microsoft', c.env.ENCRYPTION_KEY!);
    if (!creds) {
        return c.redirect(
            '/accounts?error=' +
                encodeURIComponent(
                    'Microsoft OAuth not configured. Go to Settings to add your Microsoft Client ID and Secret.'
                )
        );
    }

    const state = generateToken();
    const redirectUri = `${getBaseUrl(c.req.raw)}/oauth/microsoft/callback`;
    const authUrl = getMicrosoftAuthUrl(creds.clientId, redirectUri, state);

    // Set a short-lived signed cookie to prevent OAuth CSRF (finding #5)
    await setSignedCookie(c, 'oauth_state', state, c.env.JWT_SECRET!, {
        path: '/',
        secure: true,
        httpOnly: true,
        maxAge: 600, // 10 minutes
        sameSite: 'Lax', // Must be lax for cross-site redirect to work
    });

    return c.redirect(authUrl);
});

oauth.get('/microsoft/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error || !code) {
        return c.redirect('/accounts?error=' + encodeURIComponent('Microsoft OAuth was denied or failed.'));
    }

    // Verify OAuth CSRF State (finding #5)
    const storedState = await getSignedCookie(c, c.env.JWT_SECRET!, 'oauth_state');
    deleteCookie(c, 'oauth_state');

    if (!storedState || storedState !== state) {
        return c.redirect('/accounts?error=' + encodeURIComponent('Security verification failed. Please try again.'));
    }

    try {
        const creds = await getOAuthCredentials(c.env.DB, 'microsoft', c.env.ENCRYPTION_KEY!);
        if (!creds) throw new Error('Microsoft OAuth credentials not found');

        const redirectUri = `${getBaseUrl(c.req.raw)}/oauth/microsoft/callback`;
        const tokens = await exchangeMicrosoftCode(code, creds.clientId, creds.clientSecret, redirectUri);
        const email = await getMicrosoftUserEmail(tokens.access_token);

        const encryptedAccess = await encrypt(tokens.access_token, c.env.ENCRYPTION_KEY!);
        const encryptedRefresh = await encrypt(tokens.refresh_token, c.env.ENCRYPTION_KEY!);
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

        await c.env.DB.prepare(
            `INSERT INTO email_accounts (alias, email_address, provider, encrypted_access_token, encrypted_refresh_token, token_expires_at)
         VALUES (?, ?, 'microsoft', ?, ?, ?)`
        )
            .bind(email, email, encryptedAccess, encryptedRefresh, expiresAt)
            .run();

        return c.redirect('/accounts?message=' + encodeURIComponent(`Outlook account ${email} connected!`));
    } catch (err: any) {
        console.error('Microsoft OAuth Error:', err);
        return c.redirect('/accounts?error=' + encodeURIComponent('Microsoft OAuth failed. Please try again.'));
    }
});

export default oauth;
