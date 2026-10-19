# Connecting e-zer0 to ChatGPT

Use the existing deployed MCP server. You do not need a new e-zer0 deployment,
manual agent credentials or a bearer-token environment variable for OAuth.

## Current Plugins UI

1. In ChatGPT, open **Plugins > Add > Create custom MCP server**.
2. Choose a name such as **e-zer0 Personal** and enter the full endpoint:

    ```text
    https://your-worker.your-subdomain.workers.dev/mcp
    ```

3. Select **OAuth** if asked. Complete e-zer0 sign-in and consent, name this
   connection recognisably and select permitted mailboxes. Selecting none is
   valid: authentication succeeds without mailbox access.
4. Under **e-zer0 > Agents > Edit**, select **Calendar (read-only)** for the desired
   accounts in the permission table and click **Save Changes**. The **Email**
   column controls mailbox access independently. Mailbox consent does not
   automatically grant calendar access.
5. Open the plugin's **Permission** control and allow the tools you need. Prefer
   approval prompts for writes rather than allowing all tools indiscriminately.
   These ChatGPT approvals are separate from e-zer0's mailbox and calendar grants;
   allowing all tools does not grant access to additional accounts.
6. Open the plugin and choose **Try in chat**, or select it in the conversation.
   Ask it to list permitted email and calendar accounts before reading data.

Controls vary by account and rollout. Some interfaces instead show **Settings >
Apps > Advanced settings > Developer mode**, then **Create app** and **Scan Tools**.
Use the entry point present in your interface. A **dev mode** or **DEVELOPMENT**
label is not, by itself, a failure. Available actions and approvals depend on the
ChatGPT surface and account; listing a tool does not prove a call succeeds.

## Finding and Refreshing Tools

The connection page need not show actions inline. Open **View details** or the
app's tool-details panel. OAuth connected and tools discovered are separate
checks; neither proves mailbox permission.

After an e-zer0 update, choose **Manage app > Refresh tools**, review permissions,
then open a new conversation and select the plugin again. Reinstalling or
reconnecting should not be the first troubleshooting step.

If tools are listed but unavailable in chat, check the plugin's **Permission**
control. After changing permissions, start a new chat and select the plugin again.
An existing conversation may not reflect the updated connection. Test an actual
read before reinstalling; a successful email read does not verify calendar access,
Outlook access or write actions.

e-zer0 advertises explicit `readOnlyHint`, `destructiveHint` and `openWorldHint`
annotations. Read/search/list tools are read-only; draft creation, moves,
read/unread changes, rules and task mutations are writes. Every tool labelled
**Write** can indicate missing/stale annotations, not missing tools. Refresh
after deploying annotation changes. These hints guide labels and approvals;
e-zer0 still enforces OAuth and account permissions itself.

Test `list_connected_accounts`, `list_calendar_accounts`, then `list_calendars`
and `get_calendar_events` for a short range with explicit timezone offsets.
Test email mutations only on disposable messages. `draft_email_reply` creates a
draft, never sends it. There are no calendar editing, invitation or RSVP tools.

## Calendar Provider Setup

Enable Google Calendar API in the existing Google Cloud project and add
`calendar.calendarlist.readonly` and `calendar.events.readonly` consent scopes.
Microsoft uses delegated `Calendars.Read`, not `Calendars.ReadWrite`.
Reconnect through **Add Gmail / Add Outlook**, without disconnecting first, to
approve new scopes while preserving agent mappings. Refreshing an old provider
token does not grant new consent. See the in-app Settings instructions.

## Codex and Private Plugin Packages

A direct `codex mcp add` configuration is a separate desktop connection; do not
assume it automatically creates a ChatGPT web connection. Authenticate the
existing Codex entry with `codex mcp login ezer0` rather than adding bearer tokens.

`plugins/e-zer0-personal` is an optional template. Replace its example.com MCP
endpoint with your own before packaging. It is not the recommended web setup
path. Imported MCP-declaring plugins can be
**Desktop only**, even with HTTPS URLs. Do not claim web or dot compatibility
from an archive upload alone: verify a real tool call on the intended surface.
Dots can share supported connected plugin permissions, but access to this
particular connection still needs testing.

References: [Plugin quickstart](https://developers.openai.com/plugins/quickstart),
[tool annotations](https://developers.openai.com/plugins/build/mcp-server),
[legacy MCP app setup](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt),
[Desktop-only limitations](https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github),
and [dot permissions](https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs).
