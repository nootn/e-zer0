# Connecting e-zer0 to Microsoft Copilot Studio

e-zer0 supports OAuth dynamic client registration and remote MCP OAuth discovery. If your Copilot Studio environment supports automatic MCP/OAuth discovery, use that flow first.

## Prerequisite

You need to be signed in to your deployed e-zer0 dashboard so you can approve the browser-based authorization request.

## Recommended Setup

1. Add a new MCP server in Copilot Studio.

2. Use your deployed MCP endpoint as the server URL:

   `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp`

3. Choose the automatic or discovery-based OAuth option if your Copilot Studio build offers one.

4. When e-zer0 opens its authorization page:

   - review or change the `Agent Name`
   - choose the `Permitted Email Accounts`
   - optionally leave all accounts unselected if you only want to complete sign-in for now

5. Finish the OAuth approval flow and return to Copilot Studio.

## Important Notes

- Mailbox access is controlled separately from sign-in.
- A successfully authorized Copilot client with zero selected accounts can authenticate but will not be able to access any mailboxes yet.
- Permissions can be changed later in `Agent Management`.

## Fallback

If your Copilot Studio tenant or MCP UI does not support automatic OAuth registration/discovery, use the manual fallback instructions in [MANUAL_CREDENTIALS.md](./MANUAL_CREDENTIALS.md).
