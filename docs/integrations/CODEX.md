# Integrating e-zer0 with OpenAI Codex

e-zer0 exposes a remote MCP server over Streamable HTTP, so Codex can connect to it directly without a local bridge.

## Step-by-Step Setup

1. Add your deployed MCP server to Codex:

    ```powershell
    codex mcp add ezer0 --url https://<YOUR_INSTANCE_NAME>.workers.dev/mcp
    ```

2. Start the OAuth login flow:

    ```powershell
    codex mcp login ezer0
    ```

3. Approve the authorization request in your e-zer0 web UI when Codex opens the browser.

4. On the e-zer0 authorization page:

   - review or change the `Agent Name`
   - choose the `Permitted Email Accounts`
   - optionally leave all accounts unselected if you only want to complete sign-in for now

5. Verify the connection:

    ```powershell
    codex mcp list
    codex mcp get ezer0
    ```

## Important Notes

- Mailbox access is controlled separately from sign-in.
- A successfully authorized Codex client with zero selected accounts can authenticate but will not be able to access any mailboxes yet.
- Permissions can be changed later in `Agent Management`.
- MCP access tokens now last 30 days.

## Endpoint Summary

- MCP endpoint: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp`
- Token endpoint: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/token`
- Authorization endpoint: `https://<YOUR_INSTANCE_NAME>.workers.dev/authorize`
- Registration endpoint: `https://<YOUR_INSTANCE_NAME>.workers.dev/register`
