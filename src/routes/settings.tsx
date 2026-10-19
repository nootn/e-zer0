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
                    <p class="page-subtitle">Configure email, calendar and task providers to connect your accounts</p>
                </div>
            </div>

            {message && <Alert type="success">{message}</Alert>}
            {error && <Alert type="error">{error}</Alert>}

            {/* Google Setup */}
            <div style="margin-bottom: 32px;">
                <Card title="📧 Google (Gmail, Calendar, Tasks)">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px;">
                        <div>
                            <h3 style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:12px;">
                                Setup Instructions
                            </h3>
                            <ul style="font-size:13px; color:var(--text-secondary); line-height:1.8; padding-left:18px; margin:0; list-style:disc;">
                                <li>
                                    Enable the <strong>Gmail API</strong>, <strong>Google Tasks API</strong> and{' '}
                                    <strong>Google Calendar API</strong> in the same Google Cloud project.
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
                                    In the <strong>OAuth consent screen / Data Access</strong> settings, add the scopes
                                    listed below. If an external app is in Testing, add your email under{' '}
                                    <strong>Test users</strong>.
                                </li>
                                <li>
                                    For ongoing personal use, open <strong>Google Auth Platform / Audience</strong>,
                                    select <strong>Publish app</strong> and confirm <strong>In production</strong>. Keep
                                    the same project, OAuth client and redirect URI.
                                </li>
                            </ul>

                            <p style="font-size:12px; color:var(--text-muted); margin-top:12px;">
                                Testing authorisations expire after 7 days for these Gmail scopes, including refresh
                                tokens. Regular use and background refresh cannot extend that deadline. After
                                publishing, reconnect each account through Add Gmail to obtain fresh consent. Do not
                                disconnect first: reconnecting preserves account IDs and agent grants. Refresh token
                                cannot recover an expired or revoked Google refresh token.
                            </p>
                            <p style="font-size:12px; color:var(--text-muted); margin-top:12px;">
                                Publishing and verification are separate. Google provides a personal-use verification
                                exception for fewer than 100 people known personally to the developer. Unverified
                                warnings and the user cap can remain; wider public services may require verification for
                                sensitive/restricted scopes. An open-source repository does not make your private
                                deployment a public service. Each deployment should use its own Google OAuth project.
                            </p>
                            <p style="font-size:12px; color:var(--text-muted); margin-top:12px;">
                                Production is not an email allowlist: External apps can receive consent from other
                                Google users. e-zer0 still requires admin sign-in to connect accounts or approve agents.
                                Public MCP registration does not grant mailbox access. Keep admin credentials and OAuth
                                secrets private, approve only trusted clients, and review Agents permissions. Internal
                                is suitable only when every account belongs to one Workspace/Cloud Identity
                                organisation; it cannot cover personal Gmail accounts or multiple organisations.
                            </p>
                            <p style="font-size:12px; color:var(--text-muted); margin-top:12px;">
                                Production removes the Testing deadline, not all expiry: Google can still revoke tokens,
                                including after inactivity or Gmail password changes. e-zer0 background refresh also
                                runs for unused active accounts; MCP use is not an inactivity-based retention policy.
                                Use explicit account/agent revocation rather than relying on expiry for privacy.
                            </p>
                            <p style="font-size:12px; color:var(--text-muted); margin-top:12px;">
                                Google references:{' '}
                                <a
                                    href="https://support.google.com/cloud/answer/15549945?hl=en"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Audience and publishing status
                                </a>{' '}
                                and{' '}
                                <a
                                    href="https://support.google.com/cloud/answer/13464323?hl=en"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    verification exceptions
                                </a>
                                .
                            </p>

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
                                        Then enable the{' '}
                                        <a
                                            href="https://console.cloud.google.com/apis/library/tasks.googleapis.com"
                                            target="_blank"
                                            style="color:var(--accent-hover);"
                                        >
                                            Google Tasks API
                                        </a>{' '}
                                        (needed for task management).
                                    </li>
                                    <li>
                                        Enable the{' '}
                                        <a
                                            href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style="color:var(--accent-hover);"
                                        >
                                            Google Calendar API
                                        </a>{' '}
                                        in the same project (needed for read-only calendar access).
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
                                                Add scopes: <code>https://www.googleapis.com/auth/gmail.readonly</code>,{' '}
                                                <code>https://www.googleapis.com/auth/gmail.modify</code>,{' '}
                                                <code>https://www.googleapis.com/auth/gmail.settings.basic</code>,{' '}
                                                <code>https://www.googleapis.com/auth/userinfo.email</code>,{' '}
                                                <code>https://www.googleapis.com/auth/tasks</code> (for Google Tasks),{' '}
                                                <code>
                                                    https://www.googleapis.com/auth/calendar.calendarlist.readonly
                                                </code>{' '}
                                                (list calendars), and{' '}
                                                <code>https://www.googleapis.com/auth/calendar.events.readonly</code>{' '}
                                                (read events, including recurring occurrences).
                                            </li>
                                            <li>
                                                If the external app is in Testing, add your email as a{' '}
                                                <strong>test user</strong>.
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
                                Gmail permissions support read/unread, moves and reply drafts. Google also permits
                                sending under gmail.modify, but e-zer0 blocks sending. After changing scopes, reconnect
                                accounts to approve the new permissions.
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
                                        "Any Entra ID Tenant + Personal Microsoft accounts"
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
                            <div style="margin-top:14px; padding:12px; background:var(--bg-card); border-radius:6px; border:1px solid var(--border);">
                                <p style="font-size:12px; font-weight:600; color:var(--text-primary); margin:0 0 8px 0;">
                                    🔑 Required API Permissions
                                </p>
                                <p style="font-size:11px; color:var(--text-muted); margin:0 0 8px 0;">
                                    In Azure Portal, go to{' '}
                                    <strong>
                                        API permissions → + Add a permission → Microsoft Graph → Delegated permissions
                                    </strong>{' '}
                                    and add:
                                </p>
                                <ul style="font-size:12px; color:var(--text-secondary); padding-left:16px; margin:0; line-height:1.8;">
                                    <li>
                                        <code>Mail.Read</code> — read email messages
                                    </li>
                                    <li>
                                        <code>Mail.ReadWrite</code> — move, archive, delete, mark read/unread and create
                                        reply drafts
                                    </li>
                                    <li>
                                        <code style="color:var(--accent-hover);">MailboxSettings.ReadWrite</code>{' '}
                                        <strong style="color:var(--accent-hover);">★</strong> — manage inbox rules
                                        (list, create, update, delete)
                                    </li>
                                    <li>
                                        <code style="color:var(--accent-hover);">Tasks.ReadWrite</code>{' '}
                                        <strong style="color:var(--accent-hover);">★</strong> — manage Microsoft To Do
                                        tasks (list, create, update, delete)
                                    </li>
                                    <li>
                                        <code>Calendars.Read</code> — list calendars and read events (no calendar
                                        changes)
                                    </li>
                                    <li>
                                        <code>User.Read</code> — sign in &amp; get email address
                                    </li>
                                    <li>
                                        <code>offline_access</code> — keep you signed in (auto-included)
                                    </li>
                                </ul>
                            </div>
                            <p style="font-size:12px; color:var(--text-muted); margin-top:8px;">
                                Do not add Mail.Send or Calendars.ReadWrite. e-zer0 cannot send emails or change
                                calendar events. Your organisation may require administrator consent. Reconnect accounts
                                after changing permissions; refreshing a token does not add new consent.
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
            <Card title="Reconnect and Grant Agent Access">
                <ol style="font-size:13px; color:var(--text-secondary); line-height:1.8; padding-left:18px;">
                    <li>Keep your existing OAuth app and credentials when adding these permissions.</li>
                    <li>
                        Under Email Accounts, use Add Gmail or Add Outlook / M365 and sign in again to approve the new
                        scopes. Do not disconnect first: reconnecting the same account preserves its agent grants.
                    </li>
                    <li>
                        Under Agents → Edit, select Calendar (read-only) in the account table and click Save Changes.
                        Calendar grants are separate from email grants and default to off. Selected accounts grant
                        access to all calendars readable through that account. No selections is valid.
                    </li>
                    <li>
                        Restart or reconnect your MCP client to refresh its tools. Use list_calendar_accounts,
                        list_calendars and get_calendar_events to test a short date range with your timezone.
                    </li>
                </ol>
                <p style="font-size:13px; color:var(--text-secondary);">
                    Calendar access is read-only: no event creation, editing, invitations, deletion or RSVP. Email
                    replies are saved as drafts only; review and send them yourself in Gmail or Outlook.
                </p>
            </Card>
            <div style="margin-top:24px;">
                <Card title="Connect ChatGPT">
                    <ol style="font-size:13px; color:var(--text-secondary); line-height:1.8; padding-left:18px;">
                        <li>
                            In ChatGPT, open Plugins → Add → Create custom MCP server. If your interface instead has
                            Apps → Create with Developer mode, use that entry point.
                        </li>
                        <li>
                            Name it e-zer0 Personal and use <code>{appUrl}/mcp</code>. Select OAuth and complete e-zer0
                            sign-in and mailbox consent. No manual client secret or bearer-token environment variable is
                            needed.
                        </li>
                        <li>
                            Under Agents → Edit, select Calendar (read-only) in the account table and click Save
                            Changes. Email and calendar checkboxes grant access independently. No accounts selected
                            remains valid.
                        </li>
                        <li>
                            Open the plugin's Permission control and allow the tools you need. Prefer approval prompts
                            for writes. ChatGPT tool approvals do not grant additional mailbox or calendar access in
                            e-zer0.
                        </li>
                        <li>
                            Choose Try in chat and ask it to list permitted email and calendar accounts. Use View
                            details to inspect tools: the connection page does not always show the tool list inline.
                        </li>
                        <li>
                            After server updates, use Manage app → Refresh tools and review permissions. After changing
                            permissions, start a new chat and select the plugin again. Read/list/search tools should be
                            labelled read-only; drafts, moves, read/unread changes, rules and task mutations are writes.
                        </li>
                    </ol>
                    <p style="font-size:13px; color:var(--text-secondary);">
                        A dev mode or DEVELOPMENT label does not mean the connection failed. OAuth connected and tools
                        discovered do not prove account access: test an actual permitted read before reinstalling. An
                        email read does not verify calendar access, Outlook access or write actions. ChatGPT
                        availability and approvals vary by account and surface. Imported MCP plugin archives may be
                        Desktop only; a Codex MCP configuration is not automatically a ChatGPT web connection.
                    </p>
                    <p style="font-size:13px; color:var(--text-secondary);">
                        Gmail labels: use list_email_labels/create_email_label, then change_email_labels for label-only
                        changes. These preserve INBOX and UNREAD unless explicitly requested otherwise. For existing
                        mail, use preview_email_rule, inspect full bodies with get_email, and approve specific IDs with
                        apply_email_rule_preview. Calendar invitations and incomplete bodies are untouched by previews.
                        Unknown mention formats require manual review; future Jira filters should label only.
                        Gmail-native queries and label actions are not supported by Outlook rules. search_email_page
                        provides paged IDs. get_emails also returns next_page_token and exhausted for both providers.
                        Repeat the same account, filters and count with that token until exhausted is true, even after a
                        short or empty page. Tokens expire after 30 minutes. Outlook Other and Focused are Inbox
                        classifications; text-search pages may be sparse after classification/read filtering.
                    </p>
                    <p style="font-size:13px; color:var(--text-secondary);">
                        A cancelled tool result does not prove a human cancelled it. Record the tool, UTC timestamps,
                        account ID and request ID for log correlation. Server diagnostics distinguish peer cancellation,
                        request aborts, provider failures and completed responses. There is no short server timeout; the
                        client may still impose its own limit. If a prepared tool catalog becomes stale after
                        deployment, refresh tools and start a new chat before retrying. Reconcile uncertain writes
                        before repeating them.
                    </p>
                </Card>
            </div>
            <div style="margin-top:24px;">
                <Card title="Agent Request Budgets and Retries">
                    <p style="font-size:13px; color:var(--text-secondary);">
                        All agents share the Worker request budget. Discovery, initialisation, pings, failed requests
                        and health checks count, not just email reads. One session pinging every 180 seconds costs about
                        480 requests/day; every 1800 seconds costs 48/day. Multiply by concurrent sessions. Reuse
                        connections and reduce idle keepalives only through supported client settings. Use POST{' '}
                        <code>{appUrl}/mcp</code>; 405 on an SSE GET means that stream is unsupported, not that POST
                        calls are broken. Use <code>{appUrl}/health</code> sparingly for liveness only.
                    </p>
                    <ul style="font-size:13px; color:var(--text-secondary); line-height:1.8; padding-left:18px;">
                        <li>
                            Bound transient retries with backoff and jitter; honour Retry-After and defer if the delay
                            exceeds the run budget. Do not stack retry loops. After one failed MCP authentication
                            recovery, pause and request sign-in. A mailbox-provider invalid_grant instead requires
                            reconnecting that mailbox, not repeatedly refreshing MCP credentials.
                        </li>
                        <li>
                            Confirmed Cloudflare error 1027 means daily request exhaustion: pause traffic to this
                            instance, including keepalives and scheduled retries, until the next midnight UTC plus
                            jitter or operator-confirmed recovery. Persist the cooldown across runs where supported.
                            Other 429 responses may be short-term rate limits; do not assume they are error 1027.
                        </li>
                        <li>
                            Avoid overlapping runs. Search for duplicate alerts only when there is a new candidate. Use
                            bounded date windows, successful checkpoints and deduplicated message IDs rather than
                            rereading the unread backlog. Report partial coverage; do not advance checkpoints past
                            failed pages. Verify grants with account-list tools, not private message reads.
                        </li>
                        <li>
                            Agree read/write budgets before large cleanups. Moves and read-state changes currently take
                            one message per call; no generic bulk tool is exposed. Do not create broad rules just to
                            save calls. Reconcile uncertain writes before retrying, especially drafts and moves.
                        </li>
                    </ul>
                    <p style="font-size:13px; color:var(--text-secondary);">
                        These are client operating policies, not server-enforced limits. An assistant cannot change
                        hidden retries, keepalives or timeouts by promising to wait longer; report controls that are
                        unavailable. Preserve permission and approval boundaries. See the{' '}
                        <a href="https://github.com/nootn/e-zer0/blob/main/docs/integrations/AGENT_OPERATING_GUIDE.md">
                            agent operating guide
                        </a>{' '}
                        and <a href="https://developers.cloudflare.com/workers/platform/limits/">Cloudflare limits</a>.
                    </p>
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
