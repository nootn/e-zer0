# Integrating e-zer0 with OpenClaw & NanoClaw

e-zer0 uses the **Streamable HTTP** MCP transport (POST to `/mcp`). The legacy SSE transport (`GET /mcp/sse`) is not supported and will return 405. Make sure your client is configured for `type: http`, not `type: sse`.

OpenClaw and NanoClaw do not automatically complete the OAuth client-credentials flow. The setup is:

1. Create a manual MCP client in the `e-zer0` dashboard and copy the `client_id` and `client_secret`.
2. Exchange those credentials for an access token by calling `POST /mcp/token`.
3. Configure OpenClaw or NanoClaw to connect to `/mcp` (not `/mcp/sse`) with a static `Authorization: Bearer <token>` header.

`e-zer0` access tokens now last 30 days, so you will only need to mint and replace the token when it expires.

This approach requires your OpenClaw or NanoClaw build to support custom headers on remote MCP HTTP connections. If it cannot attach an `Authorization` header, you will need either:

1. native OAuth support in the client, or
2. a small proxy/wrapper that fetches the token and injects the header.

## Step 1: Create e-zer0 credentials

1. Sign in to your deployed `e-zer0` dashboard.
2. Open the **Agent Management** section.
3. Create a new MCP client for OpenClaw or NanoClaw.
4. Copy the generated `client_id` and `client_secret`.

## Step 2: Mint an access token

Request a token from your deployed worker:

```bash
curl -X POST "https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/token" \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "client_credentials",
    "client_id": "<YOUR_CLIENT_ID>",
    "client_secret": "<YOUR_CLIENT_SECRET>"
  }'
```

The response will include:

```json
{
  "access_token": "<JWT_ACCESS_TOKEN>",
  "token_type": "Bearer",
  "expires_in": 2592000
}
```

Copy the `access_token`. You will use it as the bearer token in the MCP configuration below.

## OpenClaw Setup

1. Open your `~/.openclaw/config.yaml` file.
2. Add an MCP server entry using `type: http` pointing to `/mcp` (not `/mcp/sse`):

```yaml
mcp_servers:
  e-zer0:
    type: http
    url: "https://<YOUR_INSTANCE_NAME>.workers.dev/mcp"
    headers:
      Authorization: "Bearer <JWT_ACCESS_TOKEN>"
```

3. Restart OpenClaw so it reloads the MCP configuration.
4. When the token expires, mint a new one from `/mcp/token`, replace the `Authorization` header value, and restart OpenClaw again.

## NanoClaw Setup

1. Update the NanoClaw MCP configuration for the agent or container image you are running.
2. Use `type: http` and point at `/mcp` (not `/mcp/sse`):

```json
{
  "mcpServers": {
    "e-zer0": {
      "type": "http",
      "url": "https://<YOUR_INSTANCE_NAME>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <JWT_ACCESS_TOKEN>"
      }
    }
  }
}
```

3. Restart the NanoClaw container or agent process so it reconnects with the new header.
4. When the token expires, mint a new token from `/mcp/token`, update the config, and restart NanoClaw.

## Important limitation

This flow does not use a browser and does not require interactive login, but it also does not auto-refresh. It is only valid when the client can send custom headers on the MCP connection. If OpenClaw or NanoClaw adds first-class support for OAuth token endpoints and client-credentials exchange in the future, you can switch to that. Until then, use a pre-minted bearer token in the MCP headers where supported.
