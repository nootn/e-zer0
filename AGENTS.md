# e-zer0 Agent Instructions

This document provides instructions for AI coding agents (like Claude, GitHub Copilot, or Cursor) when working on the `e-zer0` codebase.

## 🚀 Welcome to e-zer0

e-zer0 is a self-hosted, secure bridge between AI agents and email accounts (Gmail, Outlook). It provides a Model Context Protocol (MCP) server that allows AI agents to read, search, and manage emails without exposing raw credentials. It includes active PII redaction, prompt injection protection, and full audit logging.

## 🏗️ Architecture Overview

The project is built entirely on the **Cloudflare Developer Platform**:

- **Compute:** Cloudflare Workers (TypeScript)
- **Framework:** Hono (Routing & JSX for UI)
- **Database:** Cloudflare D1 (SQLite)
- **Vector Search:** Cloudflare Vectorize (Embeddings) & Workers AI (bge-base-en-v1.5)
- **MCP Server:** `@modelcontextprotocol/sdk` (Streamable HTTP Transport)

### Key Directories

- `src/` - The Cloudflare Worker source code
    - `src/app.ts` - Main Hono application setup and routing
    - `src/index.ts` - Cloudflare Worker configuration (fetch, cron jobs)
    - `src/lib/` - Core business logic (crypto, OAuth, sanitizer, vector search)
        - `src/lib/email/` - Provider-specific API clients (Gmail, Outlook)
    - `src/mcp/` - MCP Server implementation (`tools.ts`, `server.ts`)
    - `src/routes/` - Hono route handlers (HTML pages and API endpoints)
    - `src/views/` - Hono JSX components for the web UI
- `migrations/` - D1 SQL schema migrations (`0000_...sql`, `0001_...sql`)
- `docs/` - Project documentation
    - `docs/developer-onboarding.md` - Technical deep dive for human developers

## 📜 Coding Standards & Conventions

### 1. TypeScript & Strict Typing

- Use strict TypeScript.
- Define interfaces for all external tool inputs/outputs and database rows in `src/types.ts`.
- Avoid `any` unless absolutely necessary (e.g., when dealing with deeply nested, undocumented third-party API responses).

### 2. Cloudflare Workers Ecosystem

- **No Node.js Built-ins:** The app runs on the Cloudflare Workers V8 runtime, _not_ Node.js. Do not use modules like `fs`, `path`, `crypto` (Node's version), or `child_process`.
- **Web Crypto:** Use the standardized `crypto.subtle` (Web Crypto API) for all cryptographic operations (hashing, encryption, token generation). See `src/lib/crypto.ts` for examples.
- **Environment Variables:** Access environment variables and bindings via the `c.env` object in Hono routes, or pass the `env: Env` object directly to library functions. Do not use `process.env`.
- **D1 Database:** Use the Cloudflare D1 binding API (`env.DB.prepare(...)`). Always use `bind(...)` for parameters to prevent SQL injection.

### 3. Security First 🔒

- **Secrets Management:** OAuth credentials and API keys are stored encrypted in the D1 database (`app_settings` table), _not_ as plain text environment variables. Always decrypt them right before use. See `src/lib/settings.ts`.
- **Tokens:** Access tokens for email providers are encrypted at rest using AES-256-GCM. Never log raw tokens.
- **Audit Logging:** Every action taken by an AI agent through the MCP server **must** be logged. Use the `logAudit` function in `src/mcp/tools.ts` for every tool execution.
- **Sanitization:** All email content fetched via MCP MUST pass through `sanitizeEmailContent()` in `src/lib/sanitizer.ts` to redact PII and detect prompt injection attempts.

### 4. UI / Frontend

- The UI is entirely server-side rendered using **Hono JSX**.
- Do not add client-side frameworks like React, Vue, or Svelte.
- Styling is done via plain CSS in `public/style.css` using modern CSS variables. No Tailwind.
- Keep the UI lightweight, fast, and accessible.

### 5. Testing & Quality Gates

- **Framework:** The project uses `vitest`.
- **Location:** Put test files next to the files they test (e.g., `src/lib/crypto.test.ts`).
- **Running:** Ensure `npm run check` passes before committing. This runs:
    1. `format:check` (Prettier)
    2. `lint` (`tsc --noEmit`)
    3. `test` (`vitest run`)

### 6. Email Abstraction

- The `e-zer0` MCP server provides a **unified abstraction layer** over different email providers.
- AI agents using the tools shouldn't need to know if an account is Gmail or Outlook.
- Translate unified concepts inside the `src/mcp/tools.ts` wrapper.
    - Example: A single `organize_email` tool that applies a label in Gmail or moves to a folder in Outlook.

## 🛠️ MCP Tool Creation Guide

When adding a new capability for AI agents via MCP:

1. Implement the raw API call in the provider-specific library (e.g., `src/lib/email/gmail.ts`).
2. Implement the unified wrapper logic in `src/mcp/tools.ts`. Handle the differences between providers here.
3. Expose the tool in `src/mcp/server.ts` using `server.tool(...)`.
4. Provide a highly descriptive `description` string for the tool and its arguments. The LLM relies on these exact words to know when and how to use the tool.
5. **CRUCIAL:** Wrap the tool execution in a `try/catch`. Call `logAudit()` on success with the specific action details, and call `logAudit()` again in the `catch` block on failure with the error message. Return `isError: true` if an exception occurs.
