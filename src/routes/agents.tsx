/** @jsxImportSource hono/jsx */
import { Hono, type Context } from 'hono';
import type { Env, McpClient, EmailAccount } from '../types';
import { Layout, Card, Alert, EmptyState } from '../views/layout';
import { generateSalt, hashPassword, generateClientId, generateClientSecret } from '../lib/crypto';

type AgentEnv = {
    Bindings: Env;
    Variables: {
        userId: number;
        username: string;
        newClientId?: string;
        newSecret?: string;
        newName?: string;
    };
};
const agents = new Hono<AgentEnv>();
const MAX_CLIENT_NAME_LENGTH = 100;
type PermissionAccount = Pick<EmailAccount, 'id' | 'alias' | 'email_address' | 'status'>;

function AccountPermissions({
    accounts,
    emailIds = [],
    calendarIds = [],
}: {
    accounts: PermissionAccount[];
    emailIds?: number[];
    calendarIds?: number[];
}) {
    return (
        <div>
            <input type="hidden" name="permissions_form" value="combined" />
            <p style="color:var(--text-secondary); font-size:12px; margin-bottom:12px;">
                Choose email and read-only calendar access separately. No selections is valid. Calendar access includes
                all calendars readable through the account. Inactive account grants resume after reconnecting.
            </p>
            {accounts.length === 0 ? (
                <p>No accounts connected yet.</p>
            ) : (
                <div class="table-container">
                    <table style="table-layout:fixed;">
                        <thead>
                            <tr>
                                <th scope="col" style="width:50%; padding:10px 8px;">
                                    Account
                                </th>
                                <th scope="col" style="width:20%; padding:10px 4px; text-align:center;">
                                    Email
                                </th>
                                <th scope="col" style="width:30%; padding:10px 4px; text-align:center;">
                                    Calendar (read-only)
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.map((account) => (
                                <tr>
                                    <th
                                        scope="row"
                                        style="text-align:left; font-size:14px; font-weight:normal; overflow-wrap:anywhere; padding:12px 8px; border-bottom:1px solid var(--border);"
                                    >
                                        {account.email_address}
                                        {account.alias && account.alias !== account.email_address && (
                                            <> ({account.alias})</>
                                        )}
                                        {account.status !== 'active' && (
                                            <span class="badge" style="margin-left:8px;">
                                                {account.status}
                                            </span>
                                        )}
                                    </th>
                                    <td style="text-align:center; padding:12px 4px;">
                                        <input
                                            type="checkbox"
                                            name="account_ids"
                                            value={account.id}
                                            aria-label={`Email access for ${account.email_address}`}
                                            checked={emailIds.includes(account.id)}
                                        />
                                    </td>
                                    <td style="text-align:center; padding:12px 4px;">
                                        <input
                                            type="checkbox"
                                            name="calendar_account_ids"
                                            value={account.id}
                                            aria-label={`Calendar access for ${account.email_address}`}
                                            checked={calendarIds.includes(account.id)}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

async function validateAccountSelections(db: D1Database, ...selections: number[][]) {
    const accounts = await db.prepare('SELECT id FROM email_accounts').all<{ id: number }>();
    const allowed = new Set((accounts.results || []).map((account) => account.id));
    if (selections.flat().some((id) => !Number.isSafeInteger(id) || !allowed.has(id))) {
        throw new Error('Invalid account selection');
    }
}

function replaceGrants(
    db: D1Database,
    table: 'mcp_client_accounts' | 'mcp_client_calendar_accounts',
    agentId: string | number,
    ids: number[]
) {
    return [
        db.prepare(`DELETE FROM ${table} WHERE mcp_client_id = ?`).bind(agentId),
        ...[...new Set(ids)].map((id) =>
            db.prepare(`INSERT INTO ${table} (mcp_client_id, email_account_id) VALUES (?, ?)`).bind(agentId, id)
        ),
    ];
}

export async function updateAgentNameAndAccounts(
    db: D1Database,
    agentId: string | number,
    name: string,
    accountIds: number[],
    calendarIds?: number[]
) {
    await validateAccountSelections(db, accountIds, calendarIds || []);
    await db.batch([
        db.prepare('UPDATE mcp_clients SET name = ? WHERE id = ?').bind(name, agentId),
        ...replaceGrants(db, 'mcp_client_accounts', agentId, accountIds),
        ...(calendarIds === undefined ? [] : replaceGrants(db, 'mcp_client_calendar_accounts', agentId, calendarIds)),
    ]);
}

async function renderAgents(c: Context<AgentEnv>) {
    const editId = c.req.query('edit');
    const clients =
        (await c.env.DB.prepare('SELECT * FROM mcp_clients ORDER BY created_at DESC').all<McpClient>()).results || [];
    const editingClient = clients.find((client) => editId === String(client.id) && client.is_active);
    const accounts =
        (await c.env.DB.prepare('SELECT id, alias, email_address, status FROM email_accounts').all<PermissionAccount>())
            .results || [];
    const mappings =
        (
            await c.env.DB.prepare('SELECT mcp_client_id, email_account_id FROM mcp_client_accounts').all<{
                mcp_client_id: number;
                email_account_id: number;
            }>()
        ).results || [];
    const calendarGrantQuery = c.env.DB.prepare(
        'SELECT mcp_client_id, email_account_id FROM mcp_client_calendar_accounts' +
            (editingClient ? ' WHERE mcp_client_id = ?' : '')
    );
    const calendarGrants =
        (
            await (editingClient ? calendarGrantQuery.bind(editingClient.id) : calendarGrantQuery).all<{
                mcp_client_id: number;
                email_account_id: number;
            }>()
        ).results || [];
    const message = c.req.query('message');
    const error = c.req.query('error');

    return c.html(
        <Layout title="Agents" username={c.get('username')} activeNav="agents">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Agent Management</h1>
                    <p class="page-subtitle">Create and manage MCP agent credentials</p>
                </div>
            </div>
            {message && <Alert type="success">{message}</Alert>}
            {error && <Alert type="error">{error}</Alert>}
            {c.get('newClientId') && c.get('newSecret') && (
                <div class="card" style="border-color:var(--success); margin-bottom:24px;">
                    <h3 class="card-title">New Agent Created: {c.get('newName')}</h3>
                    <p style="margin-bottom:16px;">Save these credentials now: the secret will not be shown again.</p>
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
            <Card title={editingClient ? 'Edit Agent' : 'Create New Agent'}>
                <form
                    method="post"
                    action={editingClient ? `/agents/${editingClient.id}/accounts` : '/agents/create'}
                    style="display:flex; flex-direction:column; gap:16px;"
                >
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
                            maxlength={MAX_CLIENT_NAME_LENGTH}
                            value={editingClient?.name}
                            placeholder='e.g. "Claude Desktop"'
                        />
                    </div>
                    <AccountPermissions
                        accounts={accounts}
                        emailIds={
                            editingClient
                                ? mappings
                                      .filter((m) => m.mcp_client_id === editingClient.id)
                                      .map((m) => m.email_account_id)
                                : []
                        }
                        calendarIds={editingClient ? calendarGrants.map((grant) => grant.email_account_id) : []}
                    />
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <a href="/agents" class="btn btn-secondary">
                            Cancel
                        </a>
                        <button type="submit" class="btn btn-primary">
                            {editingClient ? 'Save Changes' : 'Create Agent'}
                        </button>
                    </div>
                </form>
            </Card>
            {!editingClient && (
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
                                            const emailIds = mappings
                                                .filter((m) => m.mcp_client_id === client.id)
                                                .map((m) => m.email_account_id);
                                            const calendarIds = calendarGrants
                                                .filter((grant) => grant.mcp_client_id === client.id)
                                                .map((grant) => grant.email_account_id);
                                            const permittedAccounts = accounts.filter(
                                                (account) =>
                                                    emailIds.includes(account.id) || calendarIds.includes(account.id)
                                            );
                                            return (
                                                <tr>
                                                    <td style="font-weight:500;">{client.name}</td>
                                                    <td>
                                                        <span
                                                            class="code-block"
                                                            style="padding:4px 8px; font-size:12px;"
                                                        >
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
                                                        {permittedAccounts.length ? (
                                                            <div style="display:flex; flex-wrap:wrap; gap:4px;">
                                                                {permittedAccounts.map((account) => (
                                                                    <span
                                                                        class="badge"
                                                                        style="background:var(--border); color:var(--text-primary);"
                                                                    >
                                                                        {account.alias || account.email_address}:{' '}
                                                                        {[
                                                                            ...(emailIds.includes(account.id)
                                                                                ? ['Email']
                                                                                : []),
                                                                            ...(calendarIds.includes(account.id)
                                                                                ? ['Calendar (read-only)']
                                                                                : []),
                                                                        ].join(', ')}
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
                                                            <div style="display:flex; gap:8px; align-items:center;">
                                                                <a
                                                                    href={`/agents?edit=${client.id}`}
                                                                    class="btn btn-primary btn-sm"
                                                                >
                                                                    Edit
                                                                </a>
                                                                <form
                                                                    method="post"
                                                                    action={`/agents/${client.id}/revoke`}
                                                                    style="margin:0;"
                                                                >
                                                                    <button type="submit" class="btn btn-danger btn-sm">
                                                                        Revoke
                                                                    </button>
                                                                </form>
                                                            </div>
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
            )}
        </Layout>
    );
}
agents.get('/', renderAgents);

agents.post('/create', async (c) => {
    const form = await c.req.formData();
    const name = form.get('name')?.toString().trim();
    const accountIds = form.getAll('account_ids').map((id) => Number(id.toString()));
    const calendarIds = form.getAll('calendar_account_ids').map((id) => Number(id.toString()));
    if (!name || name.length > MAX_CLIENT_NAME_LENGTH) {
        return c.redirect(
            '/agents?error=' +
                encodeURIComponent(`Agent name is required and must be ${MAX_CLIENT_NAME_LENGTH} characters or fewer.`)
        );
    }
    const clientId = generateClientId();
    const clientSecret = generateClientSecret();
    const salt = generateSalt();
    const secretHash = await hashPassword(clientSecret, salt);
    try {
        await validateAccountSelections(c.env.DB, accountIds, calendarIds);
        const statements = [
            c.env.DB.prepare(
                `INSERT INTO mcp_clients (
                name, client_id, secret_hash, salt, redirect_uris, grant_types, token_endpoint_auth_method
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
                // UI-created agents use client credentials; browser OAuth clients come from /register.
                .bind(name, clientId, secretHash, salt, '[]', '["client_credentials"]', 'client_secret_post'),
        ];
        for (const [table, ids] of [
            ['mcp_client_accounts', accountIds],
            ['mcp_client_calendar_accounts', calendarIds],
        ] as const) {
            statements.push(
                ...[...new Set(ids)].map((id) =>
                    c.env.DB.prepare(
                        `INSERT INTO ${table} (mcp_client_id, email_account_id)
                    SELECT id, ? FROM mcp_clients WHERE client_id = ?`
                    ).bind(id, clientId)
                )
            );
        }
        await c.env.DB.batch(statements);
    } catch (error) {
        return c.redirect(
            '/agents?error=' + encodeURIComponent(error instanceof Error ? error.message : 'Could not create agent')
        );
    }
    // Render directly so credentials never enter the URL.
    c.set('newClientId', clientId);
    c.set('newSecret', clientSecret);
    c.set('newName', name);
    return renderAgents(c);
});

agents.post('/:id/revoke', async (c) => {
    await c.env.DB.prepare('UPDATE mcp_clients SET is_active = 0 WHERE id = ?').bind(c.req.param('id')).run();
    return c.redirect('/agents?message=' + encodeURIComponent('Agent revoked successfully.'));
});

agents.post('/:id/accounts', async (c) => {
    const id = c.req.param('id');
    const form = await c.req.formData();
    const name = form.get('name')?.toString().trim();
    const accountIds = form.getAll('account_ids').map((id) => Number(id.toString()));
    // Older open pages submit only email permissions; do not clear their calendar grants.
    const calendarIds =
        form.get('permissions_form') === 'combined'
            ? form.getAll('calendar_account_ids').map((id) => Number(id.toString()))
            : undefined;
    if (!name || name.length > MAX_CLIENT_NAME_LENGTH) {
        return c.redirect(
            '/agents?edit=' +
                encodeURIComponent(id) +
                '&error=' +
                encodeURIComponent(`Agent name is required and must be ${MAX_CLIENT_NAME_LENGTH} characters or fewer.`)
        );
    }
    const client = await c.env.DB.prepare('SELECT id, name FROM mcp_clients WHERE id = ? AND is_active = 1')
        .bind(id)
        .first();
    if (!client) return c.redirect('/agents?error=' + encodeURIComponent('Agent not found or is revoked.'));
    try {
        await updateAgentNameAndAccounts(c.env.DB, id, name, accountIds, calendarIds);
    } catch (error) {
        return c.redirect(
            '/agents?edit=' +
                encodeURIComponent(id) +
                '&error=' +
                encodeURIComponent(error instanceof Error ? error.message : 'Could not update agent')
        );
    }
    return c.redirect('/agents?message=' + encodeURIComponent(`Agent ${name} updated.`));
});

// Retain the existing calendar-only endpoint for older open pages.
export async function updateCalendarGrants(db: D1Database, agentId: string, accountIds: number[]) {
    const client = await db.prepare('SELECT id FROM mcp_clients WHERE id = ? AND is_active = 1').bind(agentId).first();
    if (!client) throw new Error('Agent not found or revoked');
    try {
        await validateAccountSelections(db, accountIds);
    } catch {
        throw new Error('Invalid calendar account selection');
    }
    await db.batch(replaceGrants(db, 'mcp_client_calendar_accounts', agentId, accountIds));
}
agents.post('/:id/calendars', async (c) => {
    const form = await c.req.formData();
    try {
        await updateCalendarGrants(
            c.env.DB,
            c.req.param('id'),
            form.getAll('calendar_account_ids').map((value) => Number(value.toString()))
        );
        return c.redirect('/agents?message=' + encodeURIComponent('Calendar access updated.'));
    } catch (error) {
        return c.redirect(
            '/agents?error=' +
                encodeURIComponent(error instanceof Error ? error.message : 'Could not update calendar access')
        );
    }
});
export default agents;
