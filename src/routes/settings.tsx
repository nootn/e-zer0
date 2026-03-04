/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout, Card, Alert } from '../views/layout';
import { getSetting, setSetting, hasSetting } from '../lib/settings';

const settings = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

// ── GET /settings ───────────────────────────────────────

settings.get('/', async (c) => {
    const username = c.get('username');
    const message = c.req.query('message');
    const error = c.req.query('error');

    // Check which providers are configured
    const googleConfigured = await hasSetting(c.env.DB, 'GOOGLE_CLIENT_ID');
    const microsoftConfigured = await hasSetting(c.env.DB, 'MICROSOFT_CLIENT_ID');

    // Get current values (masked) for display
    let googleClientId = '';
    let microsoftClientId = '';
    try {
        const gId = await getSetting(c.env.DB, 'GOOGLE_CLIENT_ID', c.env.ENCRYPTION_KEY!);
        if (gId) googleClientId = gId.substring(0, 12) + '••••••••';
    } catch {
        /* not set */
    }
    try {
        const mId = await getSetting(c.env.DB, 'MICROSOFT_CLIENT_ID', c.env.ENCRYPTION_KEY!);
        if (mId) microsoftClientId = mId.substring(0, 12) + '••••••••';
    } catch {
        /* not set */
    }

    // Build the base URL for redirect URI display
    const baseUrl = new URL(c.req.url);
    const appUrl = `${baseUrl.protocol}//${baseUrl.host}`;

    return c.html(
        <Layout title="Settings" username={username} activeNav="settings">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Settings</h1>
                    <p class="page-subtitle">Configure email providers to connect your accounts</p>
                </div>
            </div>

            {message && <Alert type="success">{message}</Alert>}
            {error && <Alert type="error">{error}</Alert>}

            {/* Google Setup */}
            <div style="margin-bottom: 32px;">
                <Card title="📧 Google (Gmail)">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
                        <div>
                            <h3 style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:12px;">
                                Setup Instructions
                            </h3>
                            <ul style="font-size:13px; color:var(--text-secondary); line-height:1.8; padding-left:18px; margin:0; list-style:disc;">
                                <li>
                                    Enable the <strong>Gmail API</strong> in Google Cloud.
                                </li>
                                <li>
                                    Create an <strong>OAuth Client ID</strong> (Web application).
                                </li>
                                <li>
                                    Authorized redirect URI:
                                    <br />
                                    <code style="background:var(--bg-card); padding:4px 8px; border-radius:4px; color:var(--accent-hover); font-size:12px; display:inline-block; margin-top:4px;">
                                        {appUrl}/oauth/google/callback
                                    </code>
                                </li>
                                <li>
                                    In the <strong>OAuth consent screen</strong> settings, be sure to add your email
                                    address under <strong>Test users</strong>.
                                </li>
                            </ul>

                            <details style="margin-top:12px;">
                                <summary style="font-size:13px; color:var(--text-primary); font-weight:500; cursor:pointer;">
                                    📋 Show full step-by-step instructions
                                </summary>
                                <ol style="font-size:12px; color:var(--text-secondary); line-height:1.8; padding-left:18px; margin-top:8px;">
                                    <li>
                                        First, go to the{' '}
                                        <a
                                            href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                                            target="_blank"
                                            style="color:var(--accent-hover);"
                                        >
                                            Gmail API Library page
                                        </a>{' '}
                                        and click <strong>Enable</strong>.
                                    </li>
                                    <li>
                                        Go to{' '}
                                        <a
                                            href="https://console.cloud.google.com/apis/credentials"
                                            target="_blank"
                                            style="color:var(--accent-hover);"
                                        >
                                            Google Cloud Console → Credentials
                                        </a>
                                    </li>
                                    <li>Create a new project (or select an existing one)</li>
                                    <li>
                                        Click <strong>"+ Create Credentials"</strong> →{' '}
                                        <strong>"OAuth client ID"</strong>
                                    </li>
                                    <li>
                                        If prompted, configure the <strong>OAuth consent screen</strong>:
                                        <ul style="list-style:disc; padding-left:16px; margin:4px 0;">
                                            <li>
                                                User type: <strong>External</strong>
                                            </li>
                                            <li>
                                                App name: <code style="color:var(--accent-hover);">e-zer0</code>
                                            </li>
                                            <li>
                                                Add scopes: <strong>Gmail API</strong> →{' '}
                                                <code>https://mail.google.com/</code>
                                            </li>
                                            <li>
                                                Add your email as a <strong>test user</strong>
                                            </li>
                                        </ul>
                                    </li>
                                    <li>
                                        Application type: <strong>"Web application"</strong>
                                    </li>
                                    <li>Add the Authorized redirect URI above.</li>
                                    <li>
                                        Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> and paste
                                        them here →
                                    </li>
                                </ol>
                            </details>
                            <p style="font-size:12px; color:var(--text-muted); margin-top:12px;">
                                ⏱ Takes about 5 minutes. This is a one-time setup.
                            </p>
                        </div>
                        <div>
                            <form method="post" action="/settings/google">
                                <div class="form-group">
                                    <label class="form-label">Client ID</label>
                                    <input
                                        type="text"
                                        name="client_id"
                                        class="form-input"
                                        placeholder={googleClientId || 'e.g. 123456-abc.apps.googleusercontent.com'}
                                        autocomplete="off"
                                    />
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Client Secret</label>
                                    <input
                                        type="password"
                                        name="client_secret"
                                        class="form-input"
                                        placeholder={googleConfigured ? '••••••••••••' : 'e.g. GOCSPX-abc123...'}
                                        autocomplete="off"
                                    />
                                </div>
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <button type="submit" class="btn btn-primary">
                                        Save Google Credentials
                                    </button>
                                    {googleConfigured && <span class="badge badge-active">✓ Configured</span>}
                                </div>
                            </form>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Microsoft Setup */}
            <div style="margin-bottom: 32px;">
                <Card title="📬 Microsoft (Outlook.com, M365, Hotmail)">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
                        <div>
                            <h3 style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:12px;">
                                Setup Instructions
                            </h3>
                            <p style="font-size:12px; color:var(--accent-hover); margin-bottom:8px; font-weight:500;">
                                ✅ Works with personal Outlook.com, Hotmail, Live AND work/school M365 accounts
                            </p>
                            <ol style="font-size:13px; color:var(--text-secondary); line-height:1.8; padding-left:18px; margin:0;">
                                <li>
                                    Go to{' '}
                                    <a
                                        href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                                        target="_blank"
                                        style="color:var(--accent-hover);"
                                    >
                                        Azure Portal → App registrations
                                    </a>
                                </li>
                                <li>
                                    Click <strong>"+ New registration"</strong>
                                </li>
                                <li>
                                    Name: <code style="color:var(--accent-hover);">e-zer0</code>
                                </li>
                                <li>
                                    Supported account types:{' '}
                                    <strong style="color:var(--accent-hover);">
                                        "Accounts in any organizational directory AND personal Microsoft accounts"
                                    </strong>
                                    <br />
                                    <span style="font-size:11px; color:var(--text-muted);">
                                        (This is critical — it allows both M365 and Outlook.com)
                                    </span>
                                </li>
                                <li>
                                    Redirect URI → <strong>Web</strong>:<br />
                                    <code style="background:var(--bg-card); padding:4px 8px; border-radius:4px; color:var(--accent-hover); font-size:12px; display:inline-block; margin-top:4px;">
                                        {appUrl}/oauth/microsoft/callback
                                    </code>
                                </li>
                                <li>
                                    Click <strong>Register</strong>
                                </li>
                                <li>
                                    Copy the <strong>"Application (client) ID"</strong> from the overview page
                                </li>
                                <li>
                                    Go to <strong>"Certificates &amp; secrets"</strong> →{' '}
                                    <strong>"+ New client secret"</strong>
                                </li>
                                <li>
                                    Copy the <strong>Value</strong> (not the Secret ID) — paste both here →
                                </li>
                            </ol>
                            <details style="margin-top:12px;">
                                <summary style="font-size:12px; color:var(--text-muted); cursor:pointer;">
                                    📋 Required API Permissions (usually auto-granted)
                                </summary>
                                <ul style="font-size:12px; color:var(--text-muted); padding-left:16px; margin-top:6px; line-height:1.6;">
                                    <li>
                                        <code>Mail.Read</code> — read email messages
                                    </li>
                                    <li>
                                        <code>Mail.ReadWrite</code> — move, archive, delete emails
                                    </li>
                                    <li>
                                        <code>User.Read</code> — get email address
                                    </li>
                                    <li>
                                        <code>offline_access</code> — refresh tokens (auto-included)
                                    </li>
                                </ul>
                            </details>
                            <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">
                                ⏱ Takes about 5 minutes. This is a one-time setup.
                            </p>
                        </div>
                        <div>
                            <form method="post" action="/settings/microsoft">
                                <div class="form-group">
                                    <label class="form-label">Client ID (Application ID)</label>
                                    <input
                                        type="text"
                                        name="client_id"
                                        class="form-input"
                                        placeholder={microsoftClientId || 'e.g. 12345678-abcd-efgh-ijkl-123456789abc'}
                                        autocomplete="off"
                                    />
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Client Secret (Value)</label>
                                    <input
                                        type="password"
                                        name="client_secret"
                                        class="form-input"
                                        placeholder={microsoftConfigured ? '••••••••••••' : 'e.g. abC8Q~xyz...'}
                                        autocomplete="off"
                                    />
                                </div>
                                <div style="display:flex; gap:8px; align-items:center;">
                                    <button type="submit" class="btn btn-primary">
                                        Save Microsoft Credentials
                                    </button>
                                    {microsoftConfigured && <span class="badge badge-active">✓ Configured</span>}
                                </div>
                            </form>
                        </div>
                    </div>
                </Card>
            </div>
        </Layout>
    );
});

// ── POST /settings/google ───────────────────────────────

settings.post('/google', async (c) => {
    const body = await c.req.parseBody();
    const clientId = ((body['client_id'] as string) || '').trim();
    const clientSecret = ((body['client_secret'] as string) || '').trim();

    try {
        if (clientId) {
            await setSetting(c.env.DB, 'GOOGLE_CLIENT_ID', clientId, c.env.ENCRYPTION_KEY!);
        }
        if (clientSecret) {
            await setSetting(c.env.DB, 'GOOGLE_CLIENT_SECRET', clientSecret, c.env.ENCRYPTION_KEY!);
        }
        return c.redirect(
            '/settings?message=' + encodeURIComponent('Google credentials saved! You can now add Gmail accounts.')
        );
    } catch (err: any) {
        console.error('Settings Error (Google):', err);
        return c.redirect('/settings?error=' + encodeURIComponent('Failed to save Google credentials.'));
    }
});

// ── POST /settings/microsoft ────────────────────────────

settings.post('/microsoft', async (c) => {
    const body = await c.req.parseBody();
    const clientId = ((body['client_id'] as string) || '').trim();
    const clientSecret = ((body['client_secret'] as string) || '').trim();

    try {
        if (clientId) {
            await setSetting(c.env.DB, 'MICROSOFT_CLIENT_ID', clientId, c.env.ENCRYPTION_KEY!);
        }
        if (clientSecret) {
            await setSetting(c.env.DB, 'MICROSOFT_CLIENT_SECRET', clientSecret, c.env.ENCRYPTION_KEY!);
        }
        return c.redirect(
            '/settings?message=' +
                encodeURIComponent('Microsoft credentials saved! You can now add Outlook/M365 accounts.')
        );
    } catch (err: any) {
        console.error('Settings Error (Microsoft):', err);
        return c.redirect('/settings?error=' + encodeURIComponent('Failed to save Microsoft credentials.'));
    }
});

export default settings;
