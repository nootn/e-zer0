# Security Considerations & Known Issues

This document outlines informational security notes, minor architectural limitations, and known issues within the `e-zer0` deployments. It acts as an addendum to regular penetration testing or code review cycles.

## 1. Rate Limiter Race Condition (Informational)

**Description:** 
The application utilizes Cloudflare KV for maintaining its token bucket limits (`RATE_LIMITER`), defending `/mcp/token` and `/login` against brute-force traversal. This flow relies computationally on a read-increment-write implementation over KV:
```typescript
const attemptsStr = await kv.get(key);
const attempts = attemptsStr ? parseInt(attemptsStr, 10) + 1 : 1;
await kv.put(key, attempts.toString(), { expirationTtl });
```

**Consideration:**
Cloudflare KV embraces eventual consistency and explicitly does not guarantee atomic operations on reads and writes. Thus, if a rapid burst of identical brute-force requests lands on identical geographic edge nodes simultaneously (within the ~5-50ms window), they could both read `null` constraints and sequentially write `{ attempts: 1 }`, functionally bypassing an incremental step in the blocking tally.

**Impact & Remediation:**
The practical threat modeled for this vector is negligible. `e-zer0` is architected as a single-user or small-scale self-hosted utility where sustained parallel synchronization on bad credentials carries high friction compared to automated rate-limiting backoffs. Replacing Cloudflare KV with fundamentally transactional databases like Cloudflare Durable Objects would eliminate the race condition completely, but is presently considered an over-engineered tradeoff versus KV's "free tier" operational simplicity. No action is required unless operating under highly exposed enterprise conditions.

## 2. Potential DoS via Large JSON Payloads (Informational)
**Description:** As identified during the Phase 2 Security Review, the `POST /mcp/*` endpoints accept JSON bodies from API clients for tool invocations. Currently, there is no generic application-level body size limit inside the Cloudflare Worker runtime routing sequence. An excessively large payload could cause the Cloudflare Worker to exceed its memory cap (128MB) and crash that specific request isolate (503 Service Unavailable).
**Consideration:** This primarily affects external abuse. Since MCP agents securely authenticate with generated tokens before issuing tool execution commands, non-authenticated brute force large payloads will fail auth gates before excessive JSON decoding. However, an application-wide limit (e.g., `bodyLimit({ maxSize: 10_000_000 })`) is an honorable defense-in-depth tactic for the future.

## 3. Worker Node Limits
Please consult Cloudflare's specific runtime constraints regarding memory, CPU bounding, and external execution limits to assure normal operations for heavy LLM context handling inside vector operations.
