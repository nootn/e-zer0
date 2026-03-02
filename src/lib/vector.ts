// Vector embedding and search utilities using Cloudflare Workers AI + Vectorize

export async function generateEmbedding(ai: Ai | undefined, text: string): Promise<number[]> {
    if (!ai) throw new Error('Workers AI not available (local dev mode)');
    // Truncate to ~500 chars for the embedding model
    const truncated = text.substring(0, 500);

    const result = (await ai.run('@cf/baai/bge-small-en-v1.5', {
        text: [truncated],
    })) as { data: number[][] };

    return result.data[0];
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
            id: `${accountId}:${messageId}`,
            values: embedding,
            metadata: {
                account_id: accountId,
                message_id: messageId,
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
    await vectorIndex.deleteByIds([`${accountId}:${messageId}`]);
}
