/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import type { Env, McpClient } from '../types';
import { Layout, Alert } from '../views/layout';
import { isAllowedRedirectUri, parseStoredJsonArray, requiresPkce } from '../lib/mcp-oauth';

const authorize = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

function buildAuthorizeErrorRedirect(
    clientId: string,
    redirectUri: string,
    error: string,
    state?: string,
    codeChallenge?: string,
    codeChallengeMethod?: string
) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        error,
    });

    if (state) {
        params.set('state', state);
    }

    if (codeChallenge) {
        params.set('code_challenge', codeChallenge);
    }

    if (codeChallengeMethod) {
        params.set('code_challenge_method', codeChallengeMethod);
    }

    return `/authorize?${params.toString()}`;
}

async function loadAuthorizedClient(
    c: Context<{ Bindings: Env; Variables: { userId: number; username: string } }>,
    clientId: string,
    redirectUri: string,
    codeChallenge?: string,
    codeChallengeMethod?: string
): Promise<McpClient | Response> {
    const client = await c.env.DB.prepare('SELECT * FROM mcp_clients WHERE client_id = ? AND is_active = 1')
        .bind(clientId)
        .first<McpClient>();

    if (!client) {
        return c.text('Invalid or revoked client_id', 400);
    }

    const grantTypes = parseStoredJsonArray(client.grant_types);
    if (grantTypes.length > 0 && !grantTypes.includes('authorization_code')) {
        return c.text('Client is not configured for authorization_code', 400);
    }

    if (!isAllowedRedirectUri(parseStoredJsonArray(client.redirect_uris), redirectUri)) {
        return c.text('Invalid redirect_uri', 400);
    }

    if (codeChallenge && codeChallengeMethod !== 'S256') {
        return c.text('Only PKCE code_challenge_method=S256 is supported', 400);
    }

    if (requiresPkce(client.token_endpoint_auth_method) && !codeChallenge) {
        return c.text('Public clients must use PKCE with code_challenge_method=S256', 400);
    }

    return client;
}

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

    const clientOrResponse = await loadAuthorizedClient(c, clientId, redirectUri, codeChallenge, codeChallengeMethod);
    if (clientOrResponse instanceof Response) {
        return clientOrResponse;
    }
    const client = clientOrResponse;
    const accountsResult = await c.env.DB.prepare(
        'SELECT id, alias, email_address FROM email_accounts WHERE status = ?'
    )
        .bind('active')
        .all<{ id: number; alias: string; email_address: string }>();
    const accounts = accountsResult.results ?? [];
    const mappingResult = await c.env.DB.prepare(
        'SELECT email_account_id FROM mcp_client_accounts WHERE mcp_client_id = ?'
    )
        .bind(client.id)
        .all<{ email_account_id: number }>();
    const selectedAccountIds = new Set((mappingResult.results ?? []).map((row) => row.email_account_id));

    return c.html(
        <Layout title="Authorize Required - e-zer0">
            {error && <Alert type="error">{decodeURIComponent(error)}</Alert>}
            <Alert type="warning">
                Review the display name and permitted mailbox access for this client. No accounts selected is valid and
                means the client can sign in but has no mailbox access yet.
            </Alert>
            <div class="card">
                <h2 style="font-size:20px; font-weight:600; margin-bottom:12px;">Authorize Application</h2>
                <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px;">
                    <strong>{client.name}</strong> is requesting access to act as an MCP Client on your e-zer0 server.
                </p>
                <form method="post" action="/authorize" style="display:flex; flex-direction:column; gap:16px;">
                    <input type="hidden" name="client_id" value={clientId} />
                    <input type="hidden" name="redirect_uri" value={redirectUri} />
                    <input type="hidden" name="state" value={state || ''} />
                    <input type="hidden" name="code_challenge" value={codeChallenge || ''} />
                    <input type="hidden" name="code_challenge_method" value={codeChallengeMethod || ''} />

                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="authorize-agent-name">
                            Agent Name
                        </label>
                        <input
                            class="form-input"
                            type="text"
                            id="authorize-agent-name"
                            name="name"
                            required
                            value={client.name}
                        />
                    </div>

                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label">Permitted Email Accounts</label>
                        <p style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">
                            No accounts selected is valid. You can assign or change mailbox access later in Agent
                            Management.
                        </p>
                        {accounts.length > 0 ? (
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                {accounts.map((acc) => (
                                    <label style="display:flex; align-items:center; gap:8px; font-size:14px;">
                                        <input
                                            type="checkbox"
                                            name="account_ids"
                                            value={acc.id}
                                            checked={selectedAccountIds.has(acc.id)}
                                        />
                                        <span>
                                            <strong>{acc.alias}</strong> ({acc.email_address})
                                        </span>
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <div style="font-size:13px; color:var(--text-muted); font-style:italic;">
                                No active email accounts available.
                            </div>
                        )}
                    </div>

                    <div style="display:flex; flex-direction:column; gap:12px;">
                        <button type="submit" class="btn btn-primary btn-full">
                            Allow Access
                        </button>
                        <a href="/" class="btn btn-secondary btn-full">
                            Cancel
                        </a>
                    </div>
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
    const name = form.get('name')?.toString().trim();
    const requestedAccountIds = form
        .getAll('account_ids')
        .map((value) => parseInt(value.toString(), 10))
        .filter((value) => !isNaN(value));
    const accountIds = [...new Set(requestedAccountIds)];

    if (!clientId || !redirectUri) {
        return c.text('Missing required fields', 400);
    }

    if (!name) {
        return c.text('Agent name is required', 400);
    }

    const clientOrResponse = await loadAuthorizedClient(c, clientId, redirectUri, codeChallenge, codeChallengeMethod);
    if (clientOrResponse instanceof Response) {
        return clientOrResponse;
    }
    const client = clientOrResponse;

    const userId = c.get('userId');
    if (!userId) {
        return c.text('Unauthorized', 401);
    }

    const activeAccountsResult = await c.env.DB.prepare('SELECT id FROM email_accounts WHERE status = ?')
        .bind('active')
        .all<{ id: number }>();
    const activeAccountIds = new Set((activeAccountsResult.results ?? []).map((row) => row.id));
    const hasInvalidAccountId = accountIds.some((accountId) => !activeAccountIds.has(accountId));

    if (hasInvalidAccountId) {
        return c.text('Invalid email account selection', 400);
    }

    const existingMappingsResult = await c.env.DB.prepare(
        'SELECT email_account_id FROM mcp_client_accounts WHERE mcp_client_id = ?'
    )
        .bind(client.id)
        .all<{ email_account_id: number }>();
    const preservedNonActiveAccountIds = (existingMappingsResult.results ?? [])
        .map((row) => row.email_account_id)
        .filter((accountId) => !activeAccountIds.has(accountId));
    const replacementAccountIds = [...new Set([...accountIds, ...preservedNonActiveAccountIds])];

    // Generate authorization code
    const code = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    try {
        const statements = [
            c.env.DB.prepare('UPDATE mcp_clients SET name = ? WHERE id = ?').bind(name, client.id),
            c.env.DB.prepare('DELETE FROM mcp_client_accounts WHERE mcp_client_id = ?').bind(client.id),
        ];

        if (replacementAccountIds.length > 0) {
            statements.push(
                ...replacementAccountIds.map((accountId) =>
                    c.env.DB.prepare(
                        'INSERT INTO mcp_client_accounts (mcp_client_id, email_account_id) VALUES (?, ?)'
                    ).bind(client.id, accountId)
                )
            );
        }

        statements.push(
            c.env.DB.prepare(
                `INSERT INTO oauth_auth_codes (id, client_id, redirect_uri, code_challenge, code_challenge_method, expires_at, user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(code, clientId, redirectUri, codeChallenge || null, codeChallengeMethod || null, expiresAt, userId)
        );

        await c.env.DB.batch(statements);
    } catch (error) {
        console.error('Failed to create auth code:', error);
        return c.redirect(
            buildAuthorizeErrorRedirect(
                clientId,
                redirectUri,
                'Internal Error',
                state,
                codeChallenge,
                codeChallengeMethod
            )
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
