# e-zer0 — Claude Code Instructions

Full agent instructions and coding standards: @AGENTS.md

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Quality gate (format + lint + test) | `npm run check` |
| Format | `npm run format` |
| Type-check / lint | `npm run lint` |
| Tests | `npm run test` |
| Apply local DB migrations | `npm run db:migrate:local` |
| Reset local DB | `npm run db:reset:local:unix` |
| Deploy | `npm run deploy` |

## Runtime constraint

This runs on **Cloudflare Workers (V8 isolates), not Node.js**. Never use Node built-ins (`fs`, `path`, `crypto`, `process.env`). Use `crypto.subtle`, `c.env`, and the D1/KV binding APIs instead.

## Key files

- `src/index.ts` — Worker entry point
- `src/app.ts` — Hono app + route registration
- `src/types.ts` — All shared interfaces and DB row types
- `src/mcp/server.ts` — MCP tool registration
- `src/mcp/tools.ts` — MCP tool implementations (always call `logAudit`)
- `src/lib/sanitizer.ts` — PII redaction + prompt injection detection (apply to all email content)
- `wrangler.toml` — Worker + D1 binding config
- `migrations/` — D1 SQL migrations (append-only, never edit existing files)
