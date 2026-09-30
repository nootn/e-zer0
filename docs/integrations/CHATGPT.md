# Connecting e-zer0 to ChatGPT web

The private plugin in `plugins/e-zer0-personal` declares a connection to the
personal deployment at `https://e-zer0-noootn.noootn.workers.dev/mcp`.
It uses the existing remote MCP server and its OAuth flow; it contains no secrets
and does not host or proxy email data.

## Install and connect

1. Package the directory from the repository root:

    ```powershell
    Compress-Archive -Path plugins/e-zer0-personal -DestinationPath "$env:TEMP/e-zer0-personal.zip" -Force
    ```

2. Ask Plugin Creator to create a private plugin from the archive, or use the
   plugin upload option if it is available to your account.
3. Open the resulting plugin in ChatGPT web and choose Install and Connect.
4. Complete the e-zer0 sign-in and consent screen. Give this connection a
   recognizable name and select its permitted mailboxes. Zero mailboxes is valid.
5. Mention `@e-zer0 Personal` and ask it to list permitted email accounts.
6. Verify that only the selected mailboxes appear before testing read or search.
   Send, delete, and other email mutations are not needed to test connectivity.

The private-plugin connection flow is separate from the older developer-mode
custom-app setup. Account eligibility and rollout may still limit installation
or connection. Creating a plugin alone does not prove ChatGPT web can use its
MCP tools: complete OAuth and test an actual read-only tool call.

For another deployment, change `mcp.json` to its full `/mcp` endpoint before
packaging. Each connection uses e-zer0's existing mailbox authorization, audit
logging, content sanitization, and token lifetime.

No Worker deployment or database migration is required just to add this package
to an instance that already supports OAuth dynamic registration and refresh
tokens. Do not redeploy a Worker solely to install the plugin.

References: [Plugins in ChatGPT](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)
and [custom MCP apps](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).
