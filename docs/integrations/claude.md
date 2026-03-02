# Integrating e-zer0 with Claude (Web & Desktop)

Because e-zer0 is hosted securely on Cloudflare as a remote Model Context Protocol (MCP) server, you don't need to mess with local configuration files or install local bridges. You can connect it directly using Claude's built-in **Custom Connectors** feature, which works on both the Claude Desktop app and the web interface.

### Step-by-Step Setup

**1. Generate your Agent Credentials**
1. Log into your deployed e-zer0 web dashboard.
2. Navigate to the **Agents** or **API Tokens** section.
3. Click **Create New Agent** (name it something like "Claude UI").
4. Copy the generated **Client ID** and **Client Secret**. (You won't be able to see the secret again).

**2. Add the Connector in Claude**
1. Open the Claude Desktop app or go to `claude.ai` in your browser.
2. Click on your profile icon in the bottom left corner and select **Settings**.
3. Navigate to the **Connectors** tab.
4. Scroll to the bottom of the list and click **Add custom connector**.
5. Give your connector a name (e.g., "e-zer0 Mail").
6. In the **URL** field, paste the full URL to your deployed Cloudflare Worker's SSE endpoint:
   `https://<YOUR_INSTANCE_NAME>.workers.dev/mcp/sse`

**3. Authenticate**
1. Once you enter the URL, Claude will attempt to connect and detect that authentication is required.
2. When prompted, enter the **Client ID** and **Client Secret** you generated in Step 1.
3. Click **Connect**.

### You're Ready!
Claude will automatically discover the tools exposed by e-zer0 (like `read_recent_emails`, `search_emails_semantic`, and `manage_email`). You can now go to a normal chat window and say things like:
* *"Check my emails for any recent flight discounts."*
* *"Find the receipt from Amazon I got yesterday and summarize it."*
* *"Delete all the promotional emails from my Hotmail account."* Every action Claude takes will be securely executed and logged in your e-zer0 Audit dashboard.