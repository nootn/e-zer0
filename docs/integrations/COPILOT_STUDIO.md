# Connecting to Microsoft Copilot Studio

Microsoft Copilot Studio supports adding Model Context Protocol (MCP) servers to give your agents custom skills via REST or streaming. e-zer0 is fully compatible with Copilot Studio.

## Prerequisites

1. Access to your deployed e-zer0 dashboard.
2. An active Agent created in e-zer0 (from the **Agents** tab) with its **Client ID** and **Client Secret**.

## Configuration Steps in Copilot Studio

When adding e-zer0 as an MCP server in Copilot Studio, fill out the form as follows:

1. **Server name**: A descriptive name (e.g., `e-zer0 Email Access`).
2. **Server description**: What the server does.
3. **Server URL**: The full URL to your MCP endpoint, for example: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp`
4. **Authentication**: Select **OAuth 2.0**.
5. **Type**: Select **Manual**. *(Do **not** use "Dynamic discovery". e-zer0 uses static pre-generated agent credentials, and does not expose a dynamic registration endpoint.)*

### OAuth 2.0 Manual Settings

After selecting **Manual**, provide the following details:

- **Client ID**: The Client ID generated from the e-zer0 Agents dashboard.
- **Client secret**: The Client Secret generated from the e-zer0 Agents dashboard.
- **Authorization URL**: `https://<YOUR_INSTANCE_NAME>.workers.dev/authorize` (Replace with your actual worker URL if different)
- **Token URL**: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/token` (Replace with your actual worker URL if different)
- **Refresh Token URL**: `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/token`

Click **Create** or **Save** to finalize the connection. Copilot Studio will now authenticate securely via OAuth 2.0 and will be able to invoke the e-zer0 email tools.
