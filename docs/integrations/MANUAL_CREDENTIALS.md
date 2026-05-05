# Manual MCP Credentials Fallback

Use this flow for MCP clients that do not support automatic OAuth registration, OAuth discovery, or browser-based authorization.

## When To Use This

Use the manual flow when the client:

- cannot dynamically register an OAuth client
- cannot complete a browser-based OAuth flow
- requires a static `client_id` and `client_secret`
- requires you to mint and inject bearer tokens yourself

## Step 1: Create a Manual Agent In e-zer0

1. Sign in to your deployed e-zer0 dashboard.
2. Open `Agent Management`.
3. Create a new agent with a descriptive name.
4. Choose the `Permitted Email Accounts`.
5. Copy the generated `Client ID` and `Client Secret`.

## Step 2: Choose The Integration Pattern

### Option A: The client supports static OAuth client credentials

Use:

- Authorization URL: `https://<YOUR_INSTANCE_NAME>.workers.dev/authorize`
- Token URL: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/token`
- MCP URL: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp`

Configure the client with the generated `Client ID` and `Client Secret`.

### Option B: The client only supports a static bearer token on the MCP request

Mint a bearer token manually:

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

Use that bearer token when connecting to:

`https://<YOUR_INSTANCE_NAME>.workers.dev/mcp`

## Important Notes

- Manual agents still use the same mailbox permission model as OAuth-registered agents.
- A manual agent only sees the email accounts assigned in `Agent Management`.
- MCP access tokens now last 30 days.

## Related Docs

- Codex: [CODEX.md](./CODEX.md)
- Claude: [CLAUDE.md](./CLAUDE.md)
- Copilot Studio: [COPILOT_STUDIO.md](./COPILOT_STUDIO.md)
- OpenClaw/NanoClaw: [openclaw-nanoclaw.md](./openclaw-nanoclaw.md)
