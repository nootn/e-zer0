# Integrating e-zer0 with OpenClaw & NanoClaw

Both OpenClaw and its lightweight, containerized alternative NanoClaw natively support MCP via the Anthropic Agent SDK.

## OpenClaw Setup
OpenClaw uses a central Gateway to manage plugins and tools. To add a remote MCP server:
1. Open your `~/.openclaw/config.yaml` file.
2. Under the `mcp_servers` block, define the remote connection and pass your credentials as environment variables:

\`\`\`yaml
mcp_servers:
  e-zer0:
    type: sse
    url: "https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/sse"
    env:
      EZER0_CLIENT_ID: "<YOUR_AGENT_ID>"
      EZER0_CLIENT_SECRET: "<YOUR_AGENT_SECRET>"
\`\`\`
3. Restart the OpenClaw daemon (`systemctl restart openclaw` or equivalent). 

## NanoClaw Setup
NanoClaw runs agents in isolated Docker containers, so environment variables must be passed securely into the container runtime.
1. When spinning up a new NanoClaw agent swarm or standalone agent, update the agent's specific configuration file.
2. Ensure you map the e-zer0 credentials into the container's `.env` file so the agent can authenticate with the remote Cloudflare worker:

\`\`\`env
EZER0_CLIENT_ID=<YOUR_AGENT_ID>
EZER0_CLIENT_SECRET=<YOUR_AGENT_SECRET>
EZER0_MCP_URL=https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/sse
\`\`\`
3. Because NanoClaw builds on the Claude SDK, it will automatically connect to the SSE endpoint defined in the runtime variables on boot.