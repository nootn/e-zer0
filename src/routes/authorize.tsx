/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env, McpClient } from '../types';
import { Layout, Alert } from '../views/layout';
import { isAllowedRedirectUri, parseStoredJsonArray } from '../lib/mcp-oauth';

const authorize = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

authorize.get('/', async (c) => {
    const error = c.req.query('error');
    const clientId = c.req.query('client_id');
    const redirectUri = c.req.query('redirect_uri');
    const responseType = c.req.query('response_type');
    const state = c.req.query('state');
    const codeChallenge = c.req.query('code_challenge');
    const codeChallengeMethod = c.req.query('code_challenge_method');

    if (responseType !== 'code') {
        return c.text('Only response_type=code is supported', 400);
    }

    if (!clientId || !redirectUri) {
        return c.text('Missing client_id or redirect_uri', 400);
    }

    if (codeChallenge && codeChallengeMethod !== 'S256') {
        return c.text('Only PKCE code_challenge_method=S256 is supported', 400);
    }

    // Verify client exists
    const client = await c.env.DB.prepare('SELECT * FROM mcp_clients WHERE client_id = ? AND is_active = 1')
        .bind(clientId)
        .first<McpClient>();

    if (!client) {
        return c.text('Invalid or revoked client_id', 400);
    }

    if (!isAllowedRedirectUri(parseStoredJsonArray(client.redirect_uris), redirectUri)) {
        return c.text('Invalid redirect_uri', 400);
    }

    return c.html(
        <Layout title="Authorize Required - e-zer0">
            {error && <Alert type="error">{decodeURIComponent(error)}</Alert>}
            <div class="card" style="text-align:center;">
                <h2 style="font-size:20px; font-weight:600; margin-bottom:12px;">Authorize Application</h2>
                <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px;">
                    <strong>{client.name}</strong> is requesting access to act as an MCP Client on your e-zer0 server.
                </p>
                <form method="post" action="/authorize">
                    <input type="hidden" name="client_id" value={clientId} />
                    <input type="hidden" name="redirect_uri" value={redirectUri} />
                    <input type="hidden" name="state" value={state || ''} />
                    <input type="hidden" name="code_challenge" value={codeChallenge || ''} />
                    <input type="hidden" name="code_challenge_method" value={codeChallengeMethod || ''} />

                    <button type="submit" class="btn btn-primary btn-full">
                        Allow Access
                    </button>
                    <a href="/" class="btn btn-secondary btn-full" style="margin-top:12px; display:block;">
                        Cancel
                    </a>
                </form>
            </div>
        </Layout>
    );
});

authorize.post('/', async (c) => {
    const form = await c.req.formData();
    const clientId = form.get('client_id')?.toString();
    const redirectUri = form.get('redirect_uri')?.toString();
    const state = form.get('state')?.toString();
    const codeChallenge = form.get('code_challenge')?.toString();
    const codeChallengeMethod = form.get('code_challenge_method')?.toString();

    if (!clientId || !redirectUri) {
        return c.text('Missing required fields', 400);
    }

    const client = await c.env.DB.prepare('SELECT * FROM mcp_clients WHERE client_id = ? AND is_active = 1')
        .bind(clientId)
        .first<McpClient>();

    if (!client) {
        return c.text('Invalid or revoked client_id', 400);
    }

    if (!isAllowedRedirectUri(parseStoredJsonArray(client.redirect_uris), redirectUri)) {
        return c.text('Invalid redirect_uri', 400);
    }

    if (codeChallenge && codeChallengeMethod !== 'S256') {
        return c.text('Only PKCE code_challenge_method=S256 is supported', 400);
    }

    const userId = c.get('userId');
    if (!userId) {
        return c.text('Unauthorized', 401);
    }

    // Generate authorization code
    const code = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    try {
        await c.env.DB.prepare(
            `INSERT INTO oauth_auth_codes (id, client_id, redirect_uri, code_challenge, code_challenge_method, expires_at, user_id) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
            .bind(code, clientId, redirectUri, codeChallenge || null, codeChallengeMethod || null, expiresAt, userId)
            .run();
    } catch (error) {
        console.error('Failed to create auth code:', error);
        return c.redirect(
            `/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&error=Internal%20Error`
        );
    }

    // Build redirect URL
    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) {
        url.searchParams.set('state', state);
    }

    return c.redirect(url.toString());
});

export default authorize;
