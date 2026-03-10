// Vector embedding and search utilities using Cloudflare Workers AI + Vectorize

// Max emails to index per Worker invocation — keeps subrequest count predictable.
// Each batch of N emails costs exactly 2 subrequests (1 AI + 1 Vectorize upsert).
const MAX_BATCH_SIZE = 20;

// Vectorize enforces a 64-byte max on vector IDs. Email message IDs (especially
// Outlook's base64-encoded IDs) can exceed this, so we hash the composite key.
async function vectorId(accountId: number, messageId: string): Promise<string> {
    const raw = `${accountId}:${messageId}`;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''); // 64 hex chars — exactly at the Vectorize limit
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt < maxAttempts) {
                // Exponential backoff: 200ms, 400ms
                await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
            }
        }
    }
    throw lastError;
}

export async function generateEmbedding(ai: Ai | undefined, text: string): Promise<number[]> {
    if (!ai) throw new Error('Workers AI not available (local dev mode)');
    // Truncate to ~500 chars for the embedding model
    const truncated = text.substring(0, 500);

    const result = (await ai.run('@cf/baai/bge-small-en-v1.5', {
        text: [truncated],
    })) as { data: number[][] };

    return result.data[0];
}

export interface EmailToIndex {
    accountId: number;
    messageId: string;
    text: string;
}

/**
 * Index a batch of emails using a single Workers AI call and a single Vectorize upsert.
 * This costs exactly 2 subrequests regardless of how many emails are in the batch,
 * avoiding the "Too many subrequests" error when indexing large result sets.
 */
export async function indexEmailsBatch(
    vectorIndex: VectorizeIndex | undefined,
    ai: Ai | undefined,
    emails: EmailToIndex[]
): Promise<void> {
    if (!vectorIndex || !ai || emails.length === 0) return;

    // Cap per invocation to keep subrequest budget predictable
    const batch = emails.slice(0, MAX_BATCH_SIZE);
    const texts = batch.map((e) => e.text.substring(0, 500));

    // Single AI call for all embeddings
    const result = await withRetry(
        () => ai.run('@cf/baai/bge-small-en-v1.5', { text: texts }) as Promise<{ data: number[][] }>
    );

    const indexedAt = Math.floor(Date.now() / 1000);
    const vectors = await Promise.all(
        batch.map(async (email, i) => ({
            id: await vectorId(email.accountId, email.messageId),
            values: result.data[i],
            metadata: {
                account_id: email.accountId,
                message_id: email.messageId,
                indexed_at: indexedAt,
            },
        }))
    );

    // Single Vectorize upsert for all vectors
    await withRetry(() => vectorIndex.upsert(vectors));
}

export async function indexEmail(
    vectorIndex: VectorizeIndex | undefined,
    ai: Ai | undefined,
    accountId: number,
    messageId: string,
    text: string
): Promise<void> {
    if (!vectorIndex || !ai) return; // Gracefully skip in local dev
    const embedding = await generateEmbedding(ai, text);

    await vectorIndex.upsert([
        {
            id: await vectorId(accountId, messageId),
            values: embedding,
            metadata: {
                account_id: accountId,
                message_id: messageId,
                indexed_at: Math.floor(Date.now() / 1000), // Unix timestamp (seconds) for future purging
            },
        },
    ]);
}

export async function searchSimilar(
    vectorIndex: VectorizeIndex | undefined,
    ai: Ai | undefined,
    query: string,
    topK = 10,
    accountIds?: number[]
): Promise<Array<{ accountId: number; messageId: string; score: number }>> {
    if (!vectorIndex || !ai) return []; // Return empty in local dev
    const queryEmbedding = await generateEmbedding(ai, query);

    let filter: any = undefined;
    if (accountIds && accountIds.length > 0) {
        if (accountIds.length === 1) {
            filter = { account_id: accountIds[0] };
        } else {
            filter = { account_id: { $in: accountIds } };
        }
    }

    const results = await vectorIndex.query(queryEmbedding, {
        topK,
        filter,
        returnMetadata: 'all',
    });

    return results.matches.map((match) => ({
        accountId: (match.metadata as any)?.account_id ?? 0,
        messageId: (match.metadata as any)?.message_id ?? '',
        score: match.score,
    }));
}

export async function deleteFromIndex(
    vectorIndex: VectorizeIndex | undefined,
    accountId: number,
    messageId: string
): Promise<void> {
    if (!vectorIndex) return; // Gracefully skip in local dev
    await vectorIndex.deleteByIds([await vectorId(accountId, messageId)]);
}
