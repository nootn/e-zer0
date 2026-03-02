/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env, EmailAccount } from '../types';
import { Layout, Card, Alert, EmptyState } from '../views/layout';
import { hasSetting } from '../lib/settings';

const accounts = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

accounts.get('/', async (c) => {
    const username = c.get('username');
    const message = c.req.query('message');
    const error = c.req.query('error');

    const result = await c.env.DB.prepare('SELECT * FROM email_accounts ORDER BY created_at DESC').all<EmailAccount>();
    const emailAccounts = result.results ?? [];

    // Check D1 settings for OAuth availability
    const hasGoogle = await hasSetting(c.env.DB, 'GOOGLE_CLIENT_ID');
    const hasMicrosoft = await hasSetting(c.env.DB, 'MICROSOFT_CLIENT_ID');

    return c.html(
        <Layout title="Email Accounts" username={username} activeNav="accounts">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Email Accounts</h1>
                    <p class="page-subtitle">Connect and manage your email accounts</p>
                </div>
                <div style="display:flex; gap:8px;">
                    {hasGoogle && (
                        <a href="/oauth/google/start" class="btn btn-primary">
                            + Add Gmail
                        </a>
                    )}
                    {hasMicrosoft && (
                        <a href="/oauth/microsoft/start" class="btn btn-primary">
                            + Add Outlook / M365
                        </a>
                    )}
                    {!hasGoogle && !hasMicrosoft && (
                        <a href="/settings" class="btn btn-ghost" style="font-size:13px;">
                            ⚙️ Configure OAuth providers in Settings →
                        </a>
                    )}
                </div>
            </div>

            {message && <Alert type="success">{decodeURIComponent(message)}</Alert>}
            {error && <Alert type="error">{decodeURIComponent(error)}</Alert>}

            {emailAccounts.length === 0 ? (
                <Card>
                    <EmptyState
                        icon="📭"
                        message="No email accounts connected yet. Add a Gmail or Outlook account to get started."
                    />
                </Card>
            ) : (
                <Card>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Alias</th>
                                    <th>Email</th>
                                    <th>Provider</th>
                                    <th>Status</th>
                                    <th>Connected</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {emailAccounts.map((account) => (
                                    <tr>
                                        <td style="font-weight:500;">{account.alias}</td>
                                        <td style="color:var(--text-secondary);">{account.email_address}</td>
                                        <td>
                                            <span class="badge badge-active">
                                                {account.provider === 'google' ? '📧 Gmail' : '📬 Outlook'}
                                            </span>
                                        </td>
                                        <td>
                                            <span
                                                class={`badge badge-${account.status === 'active' ? 'active' : account.status}`}
                                            >
                                                {account.status}
                                            </span>
                                        </td>
                                        <td style="color:var(--text-muted); font-size:12px;">
                                            {new Date(account.created_at).toLocaleDateString()}
                                        </td>
                                        <td>
                                            <form
                                                method="post"
                                                action={`/accounts/${account.id}/delete`}
                                                style="display:inline;"
                                                onsubmit="return confirm('Are you sure you want to disconnect this account?')"
                                            >
                                                <button type="submit" class="btn btn-danger btn-sm">
                                                    Disconnect
                                                </button>
                                            </form>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </Layout>
    );
});

accounts.post('/:id/delete', async (c) => {
    const id = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM email_accounts WHERE id = ?').bind(id).run();
    return c.redirect('/accounts?message=' + encodeURIComponent('Account disconnected successfully.'));
});

export default accounts;
