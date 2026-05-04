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

4. Verify the connection:

   ```powershell
   codex mcp list
   codex mcp get ezer0
   ```

## What changed to support Codex

- e-zer0 now supports OAuth Dynamic Client Registration at `/register`
- The OAuth metadata advertises `registration_endpoint`
- Authorization-code exchanges now validate the original `redirect_uri`
- MCP access tokens now last 30 days

## Endpoint Summary

- MCP endpoint: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp`
- Token endpoint: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/token`
- Authorization endpoint: `https://<YOUR_INSTANCE_NAME>.workers.dev/authorize`
- Registration endpoint: `https://<YOUR_INSTANCE_NAME>.workers.dev/register`
