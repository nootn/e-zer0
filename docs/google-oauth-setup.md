# Google OAuth for a private e-zer0 deployment

## Recommended configuration

Use your own Google Cloud project and Web application OAuth client for each
deployment. For ongoing personal use with personal Gmail or accounts from multiple
organisations, choose **External** and publishing status **In production**. This
does not publish your Worker, source code or email data, and does not grant agents
access to your accounts. Publishing status and verification are separate.

Google documents a verification exception for personal use: fewer than 100 people
known personally to the developer. Unverified consent warnings and user caps may
remain. If you offer a shared/public service beyond that exception, review Google's
sensitive/restricted-scope verification requirements before opening access. An
open-source project is not automatically a shared OAuth service; self-hosters
should configure their own credentials, never reuse the maintainer's secrets.

**Internal** is an alternative only for a project associated with one Workspace or
Cloud Identity organisation and users exclusively within that organisation. It
cannot cover personal Gmail accounts or a mixture of organisations.

Sources: [verification exceptions](https://support.google.com/cloud/answer/13464323?hl=en),
[OAuth policies and personal-use definition](https://developers.google.com/identity/protocols/oauth2/policies),
[Audience settings](https://support.google.com/cloud/answer/15549945?hl=en).

## Setup and recovery

1. Enable Gmail API, Google Tasks API and Google Calendar API in the same project.
2. Configure Google Auth Platform branding, Audience and Data Access. The requested
   scopes are listed on e-zer0's **Settings** page; configure those exact scopes.
3. Create a **Web application** OAuth client. Set the exact authorised redirect URI
   to `https://YOUR_INSTANCE/oauth/google/callback`; do not add arbitrary redirects.
4. Enter the client ID and secret in e-zer0 **Settings**, not in source control.
5. In **Google Auth Platform > Audience**, select **Publish app** and confirm
   **In production**. Keep the same project, client and redirect URI when changing
   an existing deployment from Testing; do not rotate credentials as an expiry fix.
6. Connect accounts through **Email Accounts > Add Gmail**. After changing publishing
   status or scopes, sign in again to obtain fresh consent/tokens. **Do not disconnect
   first**: the callback updates the existing account and preserves its ID and agent
   mappings. Confirm the same Google account is selected during reconnection.
7. Review each agent's Email and Calendar grants independently. Test a read-only
   account listing and email/calendar read through your actual MCP client.

Approve an unverified consent warning only after confirming that it is your own
project/client and that the requested scopes are expected. Do not click through
warnings for unfamiliar apps.

## Why accounts can expire together

External apps in **Testing** issue authorisations and refresh tokens lasting
**seven days** when requesting these Gmail scopes. Accounts connected together can
therefore fail together a week later. This is a hard Testing deadline, not an idle
timeout: using MCP or repeatedly refreshing access tokens cannot extend it.

`invalid_grant` with an expired/revoked token means Google rejected the refresh
token. The **Refresh token** button cannot revive it. Check publishing status, then
reconnect after publishing. The error alone does not prove Testing was the cause:
revocation, Gmail password changes, token limits and provider policies can also
invalidate refresh tokens.

Google's short-lived access token, its longer-lived refresh token, and e-zer0's
MCP login token are distinct. Changing the MCP token lifetime does not change
Google's expiry. Production removes the Testing deadline, not all possible expiry;
there is no guaranteed never-expiring token setting.

Current e-zer0 behaviour is scheduled refresh for near-expiry tokens on active
accounts. It also refreshes unused active accounts; MCP calls do not currently
perform synchronous refresh or implement used-versus-idle retention. Consequently,
do not rely on Google's six-month refresh-token inactivity rule to revoke unused
accounts. Explicitly revoke unwanted agent grants or disconnect an account when
you no longer want it connected. Any future on-demand refresh policy would still
need to handle revocation and could not bypass Testing's deadline.

Sources: [seven-day Testing rules](https://support.google.com/cloud/answer/15549945?hl=en),
[refresh-token expiry and revocation](https://developers.google.com/identity/protocols/oauth2/).

## Keeping the deployment private

**External + In production is not Google's test-user allowlist.** Other Google
users may authorise that client; Google does not provide the Testing allowlist as
a private production-user restriction. Privacy must be enforced by the deployment.

In e-zer0, account-connection routes, callbacks, Settings and agent consent require
an admin session. There is no public Google sign-in that creates dashboard users.
OAuth callbacks also validate signed consent state. MCP calls require a valid token,
an active client and the relevant account grant. Public OAuth discovery and dynamic
client registration remain reachable by design; registration alone provides no
mailbox or calendar grants. Unrecognised client registrations can appear without
having account access: do not approve them and review/revoke unknown agents.

Keep the admin password unique and private. Protect Google/Cloudflare management
accounts with MFA, restrict who can edit the project, keep OAuth secrets out of
public repositories, and grant only trusted MCP clients the minimum account access.
Publishing does not replace these controls or constitute a security audit.

For an additional owner-email allowlist, a Cloudflare Access policy can protect
dashboard/administration routes. That is optional infrastructure, not configured
by e-zer0. Do not blindly protect the entire Worker: interactive Access challenges
on MCP, token or discovery endpoints can break external clients. Verify your
intended browser OAuth and MCP flows after any access-policy change.
