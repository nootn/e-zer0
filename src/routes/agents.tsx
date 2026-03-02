/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env, McpClient } from '../types';
import { Layout, Card, Alert, EmptyState } from '../views/layout';
import { generateSalt, hashPassword, generateClientId, generateClientSecret } from '../lib/crypto';

const agents = new Hono<{
    Bindings: Env;
    Variables: {
        userId: number;
        username: string;
        newClientId?: string;
        newSecret?: string;
        newName?: string;
    };
}>();

agents.get('/', async (c) => {
    const username = c.get('username');
    const message = c.req.query('message');
    const error = c.req.query('error');

    // Fetch clients
    const result = await c.env.DB.prepare('SELECT * FROM mcp_clients ORDER BY created_at DESC').all<McpClient>();
    const clients = result.results ?? [];

    // Fetch all active accounts
    const accountsResult = await c.env.DB.prepare(
        'SELECT id, alias, email_address FROM email_accounts WHERE status = ?'
    )
        .bind('active')
        .all();
    const accounts = accountsResult.results ?? [];

    // Fetch mappings constraint
    const mappingsResult = await c.env.DB.prepare(
        'SELECT mcp_client_id, email_account_id FROM mcp_client_accounts'
    ).all();
    const mappings = mappingsResult.results ?? [];

    // Populate allowed_accounts array for each client
    for (const client of clients) {
        client.allowed_accounts = mappings
            .filter((m: any) => m.mcp_client_id === client.id)
            .map((m: any) => m.email_account_id);
    }

    return c.html(
        <Layout title="Agents" username={username} activeNav="agents">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Agent Management</h1>
                    <p class="page-subtitle">Create and manage MCP agent credentials</p>
                </div>
            </div>

            {message && <Alert type="success">{decodeURIComponent(message)}</Alert>}
            {error && <Alert type="error">{decodeURIComponent(error)}</Alert>}

            {c.get('newClientId') && c.get('newSecret') && (
                <div class="card" style="border-color: var(--success); margin-bottom: 24px;">
                    <h3 class="card-title" style="color: var(--success);">
                        🔑 New Agent Created: {c.get('newName')}
                    </h3>
                    <p style="color:var(--text-secondary); font-size:13px; margin-bottom:16px;">
                        Save these credentials now — the secret will not be shown again.
                    </p>
                    <div class="form-group">
                        <label class="form-label">Client ID</label>
                        <div class="code-block">{c.get('newClientId')}</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Client Secret</label>
                        <div class="code-block">{c.get('newSecret')}</div>
                    </div>
                </div>
            )}

            <Card title="Create New Agent">
                <form method="post" action="/agents/create" style="display:flex; flex-direction:column; gap:16px;">
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="agent-name">
                            Agent Name
                        </label>
                        <input
                            class="form-input"
                            type="text"
                            id="agent-name"
                            name="name"
                            required
                            placeholder='e.g. "Claude Desktop"'
                        />
                    </div>
                    {accounts.length > 0 && (
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label">Permitted Email Accounts</label>
                            <p style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">
                                Select the accounts this agent should have access to. If none are selected, the agent
                                will have no access.
                            </p>
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                {accounts.map((acc: any) => (
                                    <label style="display:flex; align-items:center; gap:8px; font-size:14px;">
                                        <input type="checkbox" name="account_ids" value={acc.id} />
                                        <span>
                                            <strong>{acc.alias}</strong> ({acc.email_address})
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                    <div>
                        <button type="submit" class="btn btn-primary">
                            Generate Credentials
                        </button>
                    </div>
                </form>
            </Card>

            <div style="margin-top:24px;">
                {clients.length === 0 ? (
                    <Card>
                        <EmptyState
                            icon="🤖"
                            message="No agents configured yet. Create one to connect an AI tool like Claude Desktop."
                        />
                    </Card>
                ) : (
                    <Card title="Active Agents">
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Client ID</th>
                                        <th>Status</th>
                                        <th>Permitted Accounts</th>
                                        <th>Last Used</th>
                                        <th>Created</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {clients.map((client) => {
                                        const allowedAliases = accounts
                                            .filter((acc: any) => client.allowed_accounts?.includes(acc.id))
                                            .map((acc: any) => acc.alias);
                                        return (
                                            <tr>
                                                <td style="font-weight:500;">{client.name}</td>
                                                <td>
                                                    <span class="code-block" style="padding:4px 8px; font-size:12px;">
                                                        {client.client_id}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        class={`badge ${client.is_active ? 'badge-active' : 'badge-revoked'}`}
                                                    >
                                                        {client.is_active ? 'Active' : 'Revoked'}
                                                    </span>
                                                </td>
                                                <td style="font-size:13px; color:var(--text-secondary);">
                                                    {allowedAliases.length > 0 ? (
                                                        <div style="display:flex; flex-wrap:wrap; gap:4px;">
                                                            {allowedAliases.map((alias: string) => (
                                                                <span
                                                                    class="badge"
                                                                    style="background:var(--border-color); color:var(--text-primary);"
                                                                >
                                                                    {alias}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <em>None</em>
                                                    )}
                                                </td>
                                                <td style="color:var(--text-muted); font-size:12px;">
                                                    {client.last_used_at
                                                        ? new Date(client.last_used_at).toLocaleString()
                                                        : 'Never'}
                                                </td>
                                                <td style="color:var(--text-muted); font-size:12px;">
                                                    {new Date(client.created_at).toLocaleDateString()}
                                                </td>
                                                <td>
                                                    {client.is_active ? (
                                                        <form
                                                            method="post"
                                                            action={`/agents/${client.id}/revoke`}
                                                            style="display:inline;"
                                                            onsubmit="return confirm('Revoke this agent? It will no longer be able to access e-zer0.')"
                                                        >
                                                            <button type="submit" class="btn btn-danger btn-sm">
                                                                Revoke
                                                            </button>
                                                        </form>
                                                    ) : (
                                                        <span style="color:var(--text-muted); font-size:12px;">
                                                            Revoked
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}
            </div>
        </Layout>
    );
});

agents.post('/create', async (c) => {
    const form = await c.req.formData();
    const name = form.get('name')?.toString().trim();
    const accountIds = form
        .getAll('account_ids')
        .map((id) => parseInt(id.toString(), 10))
        .filter((id) => !isNaN(id));

    if (!name) {
        return c.redirect('/agents?error=' + encodeURIComponent('Agent name is required.'));
    }

    const clientId = generateClientId();
    const clientSecret = generateClientSecret();
    const salt = generateSalt();
    const secretHash = await hashPassword(clientSecret, salt);

    const insertResult = await c.env.DB.prepare(
        'INSERT INTO mcp_clients (name, client_id, secret_hash, salt) VALUES (?, ?, ?, ?) RETURNING id'
    )
        .bind(name, clientId, secretHash, salt)
        .first<{ id: number }>();

    if (insertResult && insertResult.id && accountIds.length > 0) {
        // Insert mappings for selected accounts
        const stmt = c.env.DB.prepare(
            'INSERT INTO mcp_client_accounts (mcp_client_id, email_account_id) VALUES (?, ?)'
        );
        const batch = accountIds.map((accountId) => stmt.bind(insertResult.id, accountId));
        await c.env.DB.batch(batch);
    }

    const newClientId = clientId;
    const newSecret = clientSecret;
    const newName = name;

    // Fetch clients
    const result = await c.env.DB.prepare('SELECT * FROM mcp_clients ORDER BY created_at DESC').all<McpClient>();
    const clients = result.results ?? [];

    // Fetch all active accounts
    const accountsResult = await c.env.DB.prepare(
        'SELECT id, alias, email_address FROM email_accounts WHERE status = ?'
    )
        .bind('active')
        .all();
    const accounts = accountsResult.results ?? [];

    // Fetch mappings constraint
    const mappingsResult = await c.env.DB.prepare(
        'SELECT mcp_client_id, email_account_id FROM mcp_client_accounts'
    ).all();
    const mappings = mappingsResult.results ?? [];

    for (const client of clients) {
        client.allowed_accounts = mappings
            .filter((m: any) => m.mcp_client_id === client.id)
            .map((m: any) => m.email_account_id);
    }

    const username = c.get('username');

    // Return the dashboard HTML directly to avoid GET param leakage
    return c.html(
        <Layout title="Agents" username={username} activeNav="agents">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Agent Management</h1>
                    <p class="page-subtitle">Create and manage MCP agent credentials</p>
                </div>
            </div>

            {newClientId && newSecret && (
                <div class="card" style="border-color: var(--success); margin-bottom: 24px;">
                    <h3 class="card-title" style="color: var(--success);">
                        🔑 New Agent Created: {newName}
                    </h3>
                    <p style="color:var(--text-secondary); font-size:13px; margin-bottom:16px;">
                        Save these credentials now — the secret will not be shown again.
                    </p>
                    <div class="form-group">
                        <label class="form-label">Client ID</label>
                        <div class="code-block">{newClientId}</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Client Secret</label>
                        <div class="code-block">{newSecret}</div>
                    </div>
                </div>
            )}

            <Card title="Create New Agent">
                <form method="post" action="/agents/create" style="display:flex; flex-direction:column; gap:16px;">
                    <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" for="agent-name">
                            Agent Name
                        </label>
                        <input
                            class="form-input"
                            type="text"
                            id="agent-name"
                            name="name"
                            required
                            placeholder='e.g. "Claude Desktop"'
                        />
                    </div>
                    {accounts.length > 0 && (
                        <div class="form-group" style="margin-bottom:0;">
                            <label class="form-label">Permitted Email Accounts</label>
                            <p style="color:var(--text-secondary); font-size:12px; margin-bottom:8px;">
                                Select the accounts this agent should have access to. If none are selected, the agent
                                will have no access.
                            </p>
                            <div style="display:flex; flex-direction:column; gap:8px;">
                                {accounts.map((acc: any) => (
                                    <label style="display:flex; align-items:center; gap:8px; font-size:14px;">
                                        <input type="checkbox" name="account_ids" value={acc.id} />
                                        <span>
                                            <strong>{acc.alias}</strong> ({acc.email_address})
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                    <div>
                        <button type="submit" class="btn btn-primary">
                            Generate Credentials
                        </button>
                    </div>
                </form>
            </Card>

            <div style="margin-top:24px;">
                {clients.length === 0 ? (
                    <Card>
                        <EmptyState
                            icon="🤖"
                            message="No agents configured yet. Create one to connect an AI tool like Claude Desktop."
                        />
                    </Card>
                ) : (
                    <Card title="Active Agents">
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Client ID</th>
                                        <th>Status</th>
                                        <th>Permitted Accounts</th>
                                        <th>Last Used</th>
                                        <th>Created</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {clients.map((client) => {
                                        const allowedAliases = accounts
                                            .filter((acc: any) => client.allowed_accounts?.includes(acc.id))
                                            .map((acc: any) => acc.alias);
                                        return (
                                            <tr>
                                                <td style="font-weight:500;">{client.name}</td>
                                                <td>
                                                    <span class="code-block" style="padding:4px 8px; font-size:12px;">
                                                        {client.client_id}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span
                                                        class={`badge ${client.is_active ? 'badge-active' : 'badge-revoked'}`}
                                                    >
                                                        {client.is_active ? 'Active' : 'Revoked'}
                                                    </span>
                                                </td>
                                                <td style="font-size:13px; color:var(--text-secondary);">
                                                    {allowedAliases.length > 0 ? (
                                                        <div style="display:flex; flex-wrap:wrap; gap:4px;">
                                                            {allowedAliases.map((alias: string) => (
                                                                <span
                                                                    class="badge"
                                                                    style="background:var(--border-color); color:var(--text-primary);"
                                                                >
                                                                    {alias}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <em>None</em>
                                                    )}
                                                </td>
                                                <td style="color:var(--text-muted); font-size:12px;">
                                                    {client.last_used_at
                                                        ? new Date(client.last_used_at).toLocaleString()
                                                        : 'Never'}
                                                </td>
                                                <td style="color:var(--text-muted); font-size:12px;">
                                                    {new Date(client.created_at).toLocaleDateString()}
                                                </td>
                                                <td>
                                                    {client.is_active ? (
                                                        <form
                                                            method="post"
                                                            action={`/agents/${client.id}/revoke`}
                                                            style="display:inline;"
                                                            onsubmit="return confirm('Revoke this agent? It will no longer be able to access e-zer0.')"
                                                        >
                                                            <button type="submit" class="btn btn-danger btn-sm">
                                                                Revoke
                                                            </button>
                                                        </form>
                                                    ) : (
                                                        <span style="color:var(--text-muted); font-size:12px;">
                                                            Revoked
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}
            </div>
        </Layout>
    );
});

agents.post('/:id/revoke', async (c) => {
    const id = c.req.param('id');
    await c.env.DB.prepare('UPDATE mcp_clients SET is_active = 0 WHERE id = ?').bind(id).run();
    return c.redirect('/agents?message=' + encodeURIComponent('Agent revoked successfully.'));
});

export default agents;
