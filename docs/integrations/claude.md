# Integrating e-zer0 with Claude

e-zer0 exposes a remote MCP server over Streamable HTTP and supports OAuth dynamic client registration, so compatible Claude clients can connect without pre-generating static credentials.

## Recommended Setup

1. Open Claude and add a custom MCP connector/server using your deployed MCP endpoint:

   `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp`

2. Let Claude start the OAuth flow.

3. When e-zer0 opens the authorization page:

   - review or change the `Agent Name`
   - choose the `Permitted Email Accounts`
   - optionally leave all accounts unselected if you only want to complete sign-in for now

4. Finish the OAuth approval flow.

5. If needed later, open `Agent Management` in e-zer0 to rename the client or change mailbox access.

## Important Notes

- Mailbox access is controlled separately from sign-in.
- A successfully authorized Claude client with zero selected accounts can authenticate but will not be able to access any mailboxes yet.
- e-zer0 uses Streamable HTTP on `/mcp`, not the legacy SSE transport.

## Fallback

If your Claude environment does not support automatic OAuth registration or remote MCP OAuth discovery, use the manual fallback instructions in [MANUAL_CREDENTIALS.md](./MANUAL_CREDENTIALS.md).
