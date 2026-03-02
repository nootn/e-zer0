// Simple rate limiter using Cloudflare KV

export async function checkRateLimit(kv: KVNamespace | undefined, key: string, limit = 5): Promise<boolean> {
    if (!kv) {
        console.error('CRITICAL: RATE_LIMITER KV namespace is NOT bound. Rate limiting is failing closed.');
        return false; // Fail closed if KV is not bound
    }

    const attemptsStr = await kv.get(key);
    const attempts = attemptsStr ? parseInt(attemptsStr, 10) : 0;

    return attempts < limit;
}

export async function incrementRateLimit(kv: KVNamespace | undefined, key: string, expirationTtl = 900): Promise<void> {
    if (!kv) {
        console.error('CRITICAL: RATE_LIMITER KV namespace is NOT bound. Cannot increment rate limit.');
        return;
    }

    const attemptsStr = await kv.get(key);
    const attempts = attemptsStr ? parseInt(attemptsStr, 10) + 1 : 1;
    // We set expirationTtl so the lockout/count naturally expires after the period
    await kv.put(key, attempts.toString(), { expirationTtl: expirationTtl });
}

export async function clearRateLimit(kv: KVNamespace | undefined, key: string) {
    if (!kv) {
        console.error('CRITICAL: RATE_LIMITER KV namespace is NOT bound. Cannot clear rate limit.');
        return;
    }
    await kv.delete(key);
}
