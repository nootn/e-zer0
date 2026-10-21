# e-zer0 threat model for OSS Scanner

## Purpose and deployment

e-zer0 is a self-hosted bridge between MCP clients and Gmail, Outlook/Microsoft
365, Google Tasks, Microsoft To Do and read-only calendars. It runs as a
TypeScript/Hono Cloudflare Worker using D1, KV and optional Workers AI/Vectorize.
It is intended for an individual or small group operating their own instance.
Connected accounts on one instance still require isolation from clients that
have not been granted access to them.

The Node.js container provides build and test tooling; production runs in the
Workers runtime. The operator and authenticated administrator are trusted to
configure the instance and grant access. A compromised Cloudflare account or
already-authorised administrator is outside that boundary. An attacker gaining
administrator access through an application flaw is in scope.

## Assets, entry points and trust boundaries

- Protect provider access/refresh tokens, OAuth client secrets, encryption and
  JWT signing keys, administrator credentials/sessions, mailbox and calendar
  contents, task data, agent credentials and account grants.
- Treat unauthenticated HTTP requests, OAuth callback parameters, redirect URIs,
  dynamic client-registration metadata, MCP JSON-RPC arguments and pagination
  tokens as adversarial. Public client registration must not itself confer any
  mailbox or calendar access.
- An authenticated MCP client may be malicious. Check every account/resource
  access against its current grants, including semantic search results,
  reconnects, revoked grants and inactive clients. Calendar grants are separate
  from mailbox grants; task operations currently use mailbox grants.
- Email bodies, subjects, snippets, HTML, sender-controlled headers, calendar
  text, task text and provider response fields are untrusted data. Follow their
  paths into HTML, tool responses, logs, queries and subsequent provider calls.
- Provider endpoints and Cloudflare bindings are trusted infrastructure, but
  their responses can contain attacker-controlled content. Mock those services
  to investigate validation, resource ownership and request construction.

## Security properties to investigate

1. Authentication and authorisation: administrator sessions, setup takeover,
   CSRF, OAuth state/redirect validation, PKCE, one-time authorisation codes,
   JWT validation, client revocation and per-account grants.
2. Secret handling: encryption/authentication correctness, key use, token
   refresh, provider credentials in settings, and accidental exposure through
   HTTP errors, tool results, HTML, logs or audit records. Encryption keys and
   JWT secrets come from Worker secrets (`src/lib/keys.ts`); provider OAuth
   credentials and tokens are encrypted in D1.
3. Provider operations: attacker-controlled account/message/folder/rule/task
   identifiers or pagination URLs must not escape the intended account or send
   credentials to an attacker-controlled endpoint. Check destructive mailbox
   actions, filter/rule changes, draft creation and task mutations.
4. Sending restrictions: e-zer0 exposes reply drafts, not a send tool. Its
   provider helpers reject send/reply/reply-all/forward endpoints. Gmail's
   `gmail.modify` scope nevertheless permits sending at the provider level, so
   this is an application boundary worth testing. Microsoft does not request
   `Mail.Send`. Calendar access must remain read-only.
5. Safe bulk changes: Gmail rule preview tokens, client/account binding,
   expiration, selected message IDs and stale-state checks must prevent an
   altered preview from authorising different changes.
6. Content and audit handling: verify sanitisation on data returned to agents,
   HTML escaping, parameterised D1 queries, and success/failure audit paths.
   PII redaction and injection detection are pattern-based mitigations, not a
   guarantee that all sensitive content or arbitrary instructions are removed.
   A missed pattern alone needs a concrete security impact to establish severity.
7. Availability: remote inputs that cause disproportionate CPU, memory,
   provider requests or stored state are relevant. Distinguish unauthenticated
   attacks from an authorised client consuming its ordinary quota.

## Source map

| Area                                            | Files                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| HTTP routing, headers, session protection       | `src/app.ts`, `src/middleware/auth.ts`, `src/lib/session.ts`, `src/routes/setup.tsx`, `src/routes/login.tsx`    |
| MCP registration, consent, tokens and transport | `src/routes/register.ts`, `src/routes/authorize.tsx`, `src/routes/mcp.ts`, `src/lib/mcp-oauth.ts`               |
| Tool schemas, grants, sanitisation and auditing | `src/mcp/server.ts`, `src/mcp/tools.ts`                                                                         |
| Provider access and mutation rules              | `src/lib/email/`, `src/lib/calendar.ts`, `src/lib/tasks/`, `src/lib/provider-request.ts`                        |
| Crypto, configuration and provider OAuth        | `src/lib/crypto.ts`, `src/lib/keys.ts`, `src/lib/settings.ts`, `src/lib/oauth/`, `src/routes/oauth-callback.ts` |
| Untrusted content and semantic search           | `src/lib/sanitizer.ts`, `src/lib/vector.ts`                                                                     |
| Schema and deployment                           | `migrations/`, `wrangler.toml`, `scripts/`, `.github/workflows/`                                                |

## How to exercise the project offline

The checkout is `/src`, installed dependencies are `/src/node_modules`, and a
dry-run Worker bundle is `/tmp/e-zer0-worker`. From `/src`:

```sh
npm run lint
npm test
./node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/e-zer0-worker
```

Tests live next to source files. `src/routes/mcp-auth.test.ts` provides fake D1
and KV implementations; `src/mcp/calendar.test.ts` and
`src/mcp/email-management.test.ts` exercise tools through the SDK's in-memory
transport. Provider tests stub `fetch`; `src/lib/vector.test.ts` mocks Workers
AI/Vectorize. Extend these patterns with synthetic accounts and messages for
proofs of concept. Existing mocks do not prove actual D1 or provider behaviour;
identify assumptions and any runtime-specific limits in the report.

No real provider, Cloudflare, email or production database credentials are
needed or provided. Do not run `setup-cf`, deployment commands without
`--dry-run`, remote migrations, OAuth sign-ins or live API calls. Never test
against deployed instances, real inboxes, external recipients or third parties.
Cloudflare remote-only bindings and provider behaviour must be mocked here;
state when a finding still needs confirmation in the real Workers runtime.

## Scope, severity and reporting

All first-party source, migrations, deployment scripts, workflows and MCP
plugin configuration are in scope. Third-party provider/Cloudflare internals
and vulnerabilities confined to dependencies are out of scope for this scan;
an exploitable misuse of a dependency by e-zer0 is in scope. Generated bundles
and `node_modules` are reference material, not separate targets.

`docs/security.md` records previous observations, including KV rate-limit
non-atomicity and payload-size concerns. Treat these as context, not as proof
that a reachable exploit is harmless or as a blanket exclusion. Validate against
the current source; `docs/security-risk-register.md` records triage decisions.

Assess severity using the demonstrated prerequisite and impact. Authentication
bypasses, provider-token disclosure, cross-account access, unauthorised sending
and destructive actions can be high or critical depending on their reach.
Availability findings depend on amplification, duration and who can trigger
them. Do not assign severity solely because sensitive data exists in the system.

Send reports privately to **nootn@hotmail.com**. Include the commit, source
location, attacker prerequisites, affected trust boundary, a minimal offline
reproducer/regression test, observed impact and a small proposed patch. Separate
verified behaviour from assumptions or missing platform evidence. Group reports
sharing one root cause; distinguish materially different exploit paths.
