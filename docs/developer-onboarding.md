# Developer Onboarding

This guide explains how e-zer0 is built, how the pieces fit together, and what you need to know to contribute or customize it.

---

## Architecture Overview

e-zer0 is a **server-side rendered (SSR) web application** — not a SPA. There is **no client-side JavaScript framework** (no React, no Vue, no hydration). Every page is rendered as plain HTML on the server and sent to the browser. Navigation is standard browser navigation (full page loads). Forms use standard HTML `<form>` submissions with POST-redirect-GET patterns.

```
┌─────────────────────────────────────────────────┐
│               Cloudflare Edge                   │
│                                                 │
│  ┌──────────┐    ┌──────────┐    ┌───────────┐  │
│  │  Hono    │───▶│  Routes  │───▶│  Views    │  │
│  │ (router) │    │ (.tsx)   │    │ (JSX→HTML)│  │
│  └──────────┘    └──────────┘    └───────────┘  │
│       │                                         │
│       ▼                                         │
│  ┌──────────┐    ┌──────────┐    ┌───────────┐  │
│  │  D1      │    │ Vectorize│    │ Workers AI│  │
│  │ (SQLite) │    │ (vectors)│    │(embeddings│  │
│  └──────────┘    └──────────┘    └───────────┘  │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │     MCP Server (JSON-RPC over HTTP)      │   │
│  │  AI agents connect here via SSE/HTTP     │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Why SSR, not SPA?

- **Simplicity** — No build step for the frontend, no bundler config, no client-side state management
- **Edge-native** — HTML is rendered on the edge (Cloudflare Workers), so pages load fast globally
- **Zero client JS** — The entire app works with JavaScript disabled in the browser (except any future interactive features)
- **Smaller footprint** — No node_modules full of React, no webpack, no hydration overhead

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | [Cloudflare Workers](https://developers.cloudflare.com/workers/) | Serverless edge compute (V8 isolates, not Node.js) |
| **Framework** | [Hono](https://hono.dev/) | Lightweight web framework (Express-like, but for edge) |
| **Templating** | [Hono JSX](https://hono.dev/docs/guides/jsx) | Server-side JSX → HTML rendering (looks like React, but it's just string concatenation at build time) |
| **Database** | [Cloudflare D1](https://developers.cloudflare.com/d1/) | SQLite at the edge (SQL database) |
| **Vector DB** | [Cloudflare Vectorize](https://developers.cloudflare.com/vectorize/) | Vector embeddings for semantic email search |
| **AI** | [Workers AI](https://developers.cloudflare.com/workers-ai/) | Generates text embeddings (for Vectorize) |
| **Local Dev** | [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | Cloudflare's CLI — runs the full Workers environment locally |
| **Styling** | Vanilla CSS | Single `layout.tsx` with embedded styles, no Tailwind |

### ⚠️ Important: This is NOT Node.js

Cloudflare Workers run on **V8 isolates**, not Node.js. This means:
- No `fs`, `path`, `http`, or other Node built-in modules
- No `npm` packages that depend on Node APIs (use edge-compatible packages only)
- Crypto is via the Web Crypto API (`crypto.subtle`), not `require('crypto')`
- Fetch is the native `fetch()`, not `node-fetch`
- TypeScript compiles to standard JavaScript that runs in V8

---

## Project Structure

```
e-zer0/
├── src/
│   ├── index.ts              # Worker entry point (HTTP handler + scheduled cron)
│   ├── app.ts                # Hono app setup, middleware, route mounting
│   ├── types.ts              # TypeScript types (Env bindings, DB row types)
│   │
│   ├── routes/               # Each file = one route group
│   │   ├── setup.tsx         # GET/POST /setup — first-run wizard
│   │   ├── login.tsx         # GET/POST /login — admin authentication
│   │   ├── dashboard.tsx     # GET /dashboard — overview stats
│   │   ├── accounts.tsx      # GET /accounts, POST /accounts/:id/delete
│   │   ├── agents.tsx        # GET /agents, POST /agents (MCP client management)
│   │   ├── audit.tsx         # GET /audit — audit log viewer
│   │   ├── settings.tsx      # GET/POST /settings — OAuth credential setup
│   │   ├── oauth-callback.ts # GET /oauth/:provider/* — OAuth flow handlers
│   │   └── mcp.ts            # POST /mcp — MCP protocol endpoint (for AI agents)
│   │
│   ├── views/
│   │   └── layout.tsx        # Shared layout (sidebar, nav, CSS, reusable components)
│   │
│   ├── lib/                  # Shared business logic
│   │   ├── crypto.ts         # AES-256-GCM encryption, PBKDF2 hashing, token generation
│   │   ├── session.ts        # Cookie-based session management
│   │   ├── keys.ts           # Auto-generated encryption/JWT key management
│   │   ├── settings.ts       # Encrypted app settings (D1 CRUD)
│   │   ├── sanitizer.ts      # PII redaction + prompt injection detection
│   │   ├── vector.ts         # Vectorize helpers (semantic search)
│   │   ├── email/
│   │   │   ├── gmail.ts      # Gmail API client (read, modify, labels)
│   │   │   └── outlook.ts    # Microsoft Graph API client (read, modify, folders)
│   │   └── oauth/
│   │       ├── google.ts     # Google OAuth 2.0 helpers
│   │       └── microsoft.ts  # Microsoft OAuth 2.0 helpers
│   │
│   ├── mcp/                  # Model Context Protocol
│   │   ├── server.ts         # MCP server setup + tool registration
│   │   └── tools.ts          # MCP tool implementations (read, manage, organize emails)
│   │
│   └── middleware/
│       └── auth.ts           # Auth middleware (session check, route protection)
│
├── migrations/               # D1 SQL migrations (applied in order)
│   ├── 0001_init_admin.sql
│   ├── 0002_email_accounts.sql
│   ├── 0003_mcp_clients.sql
│   ├── 0004_audit_logs.sql
│   └── 0005_settings.sql
│
├── wrangler.toml             # Cloudflare Worker config (bindings, triggers)
├── tsconfig.json             # TypeScript config
└── package.json              # npm scripts and dependencies
```

---

## How a Request Flows

Here's what happens when a user visits `/accounts`:

```
Browser: GET /accounts
    │
    ▼
index.ts (fetch handler)
    │ delegates to app.ts
    ▼
app.ts middleware chain:
    1. Key resolution middleware → resolves ENCRYPTION_KEY + JWT_SECRET from D1
    2. Auth middleware → checks session cookie, redirects to /login if expired
    │
    ▼
routes/accounts.tsx
    1. Queries D1: SELECT * FROM email_accounts
    2. Checks D1 settings: hasSetting('GOOGLE_CLIENT_ID')
    3. Returns JSX → Hono renders it to an HTML string
    │
    ▼
Browser receives full HTML page (no JS to hydrate)
```

### How MCP Works

AI agents connect to the `/mcp` endpoint:

```
AI Agent (Claude Desktop, etc.)
    │ HTTP POST with JSON-RPC payload
    │ Authorization: Bearer <JWT>
    ▼
routes/mcp.ts
    1. Validates JWT → identifies the MCP client
    2. Passes request to MCP server (server.ts)
    │
    ▼
mcp/server.ts
    Routes to the right tool handler
    │
    ▼
mcp/tools.ts
    1. Gets email account from D1
    2. Decrypts access token
    3. Calls Gmail API or Microsoft Graph API
    4. Sanitizes response (PII redaction, injection detection)
    5. Returns result to agent
```

---

## How Rendering Works (Hono JSX)

The `.tsx` files look like React, but they're **not React**. Hono's JSX pragma (`@jsxImportSource hono/jsx`) converts JSX into HTML strings at build time. There's no virtual DOM, no state, no hooks, no useEffect.

```tsx
// This looks like React but it's just server-side HTML templating
settings.get('/', async (c) => {
    const accounts = await c.env.DB.prepare('SELECT * FROM email_accounts').all();

    // c.html() sends the rendered HTML string as the response
    return c.html(
        <Layout title="Accounts">
            {accounts.results.map(a => <p>{a.email}</p>)}
        </Layout>
    );
});
```

**Key differences from React:**
- No `useState`, `useEffect`, or any hooks
- No client-side hydration or re-rendering
- No event handlers (onclick, etc.) — use HTML forms and links
- `class` not `className` (Hono JSX uses standard HTML attributes)
- Everything runs on the server, never in the browser

---

## How Data is Stored

### D1 (SQLite)

All persistent data lives in Cloudflare D1, an edge SQLite database:

| Table | Purpose |
|-------|---------|
| `admin_users` | Admin credentials (password hashed with PBKDF2) |
| `sessions` | Active login sessions (cookie tokens) |
| `email_accounts` | Connected email accounts (tokens encrypted AES-256-GCM) |
| `mcp_clients` | Registered AI agent credentials |
| `audit_logs` | Every MCP action logged with timestamp |
| `app_settings` | Encrypted OAuth credentials + auto-generated keys |

### Encryption Model

```
User enters OAuth Client Secret in Settings UI
    │
    ▼
settings.ts → encrypt(value, ENCRYPTION_KEY) → AES-256-GCM
    │
    ▼
D1: app_settings.encrypted_value = "iv:ciphertext:tag"
    │
    ▼
On read: decrypt("iv:ciphertext:tag", ENCRYPTION_KEY) → plaintext
```

The `ENCRYPTION_KEY` itself is auto-generated during first-run setup and stored as plaintext in `app_settings` (under the key `_ENCRYPTION_KEY`). It can optionally be overridden via a Cloudflare Worker secret.

---

## How to Add a New Page

1. Create `src/routes/my-page.tsx`:
```tsx
/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout, Card } from '../views/layout';

const myPage = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

myPage.get('/', async (c) => {
    const username = c.get('username');
    return c.html(
        <Layout title="My Page" username={username} activeNav="my-page">
            <Card title="Hello">
                <p>This is a new page.</p>
            </Card>
        </Layout>
    );
});

export default myPage;
```

2. Mount it in `src/app.ts`:
```ts
import myPageRoutes from './routes/my-page';
app.route('/my-page', myPageRoutes);
```

3. Add a nav link in `src/views/layout.tsx` (in the sidebar nav section).

That's it — no build config changes, no router config, no lazy loading.

---

## How to Add a New MCP Tool

1. Add the tool implementation in `src/mcp/tools.ts`:
```ts
export async function myNewTool(env: Env, ...args): Promise<any> {
    // Implementation
}
```

2. Register it in `src/mcp/server.ts`:
```ts
server.tool('my_new_tool', 'Description for AI agents', { /* zod schema */ }, async (args) => {
    const result = await myNewTool(env, args.whatever);
    await logAudit(env.DB, clientId, clientName, 'my_new_tool', ...);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

The MCP server uses the `@modelcontextprotocol/sdk` package and communicates via JSON-RPC over HTTP.

---

## Local Development

```bash
npm install                     # Install dependencies
npm run db:migrate:local        # Create local D1 tables
npm run dev                     # Start wrangler dev server → http://localhost:8787
```

- First visit → Setup wizard (create admin, auto-generates encryption keys)
- Wrangler emulates the full Cloudflare environment locally (D1, Vectorize, Workers AI)
- Changes to `.ts`/`.tsx` files auto-reload
- Local D1 data lives in `.wrangler/state/` (gitignored)
- No `.dev.vars` or secrets needed — everything is self-service through the UI

### Resetting Local State

```bash
npm run db:reset:local          # Windows: wipe DB + re-migrate
npm run db:reset:local:unix     # macOS/Linux equivalent
```

---

## Deployment

Only **2 secrets** are needed for deployment:
- `CLOUDFLARE_API_TOKEN` — for the GitHub Action to deploy
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account

Everything else (encryption keys, OAuth credentials, admin account) is configured through the UI after deployment. See the README for one-click deployment instructions.
