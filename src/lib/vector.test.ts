import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateEmbedding, indexEmail, indexEmailsBatch, searchSimilar, deleteFromIndex } from './vector';

describe('generateEmbedding', () => {
    it('throws when AI is not available', async () => {
        await expect(generateEmbedding(undefined, 'test')).rejects.toThrow('Workers AI not available');
    });

    it('truncates text to 500 chars', async () => {
        const longText = 'a'.repeat(1000);
        const mockAi = {
            run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }),
        } as any;

        await generateEmbedding(mockAi, longText);

        // The text passed to AI should be truncated
        const calledWith = mockAi.run.mock.calls[0][1];
        expect(calledWith.text[0]).toHaveLength(500);
    });

    it('calls the correct AI model', async () => {
        const mockAi = {
            run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }),
        } as any;

        await generateEmbedding(mockAi, 'Hello');
        expect(mockAi.run).toHaveBeenCalledWith('@cf/baai/bge-small-en-v1.5', { text: ['Hello'] });
    });
});

describe('indexEmail', () => {
    it('gracefully skips when vectorIndex is undefined', async () => {
        // Should not throw
        await indexEmail(undefined, undefined, 1, 'msg1', 'test text');
    });

    it('gracefully skips when ai is undefined', async () => {
        const mockIndex = { upsert: vi.fn() } as any;
        await indexEmail(mockIndex, undefined, 1, 'msg1', 'test text');
        expect(mockIndex.upsert).not.toHaveBeenCalled();
    });

    it('upserts with correct ID format when both are available', async () => {
        const mockAi = {
            run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }),
        } as any;
        const mockIndex = { upsert: vi.fn().mockResolvedValue(undefined) } as any;

        await indexEmail(mockIndex, mockAi, 42, 'msg-abc', 'some email text');

        expect(mockIndex.upsert).toHaveBeenCalledWith([
            expect.objectContaining({
                id: '0aee47c066a8883b81c9dc2a9163851b8179cb0b66a8a566cd71014b37374526',
                metadata: expect.objectContaining({
                    account_id: 42,
                    message_id: 'msg-abc',
                    indexed_at: expect.any(Number),
                }),
            }),
        ]);
    });
});

describe('indexEmailsBatch', () => {
    it('gracefully skips when vectorIndex or ai is undefined', async () => {
        await indexEmailsBatch(undefined, undefined, [{ accountId: 1, messageId: 'msg1', text: 'hello' }]);
        // Should not throw
    });

    it('gracefully skips when emails array is empty', async () => {
        const mockAi = { run: vi.fn() } as any;
        const mockIndex = { upsert: vi.fn() } as any;
        await indexEmailsBatch(mockIndex, mockAi, []);
        expect(mockAi.run).not.toHaveBeenCalled();
        expect(mockIndex.upsert).not.toHaveBeenCalled();
    });

    it('makes one AI call and one upsert for multiple emails', async () => {
        const mockAi = {
            run: vi.fn().mockResolvedValue({
                data: [
                    [0.1, 0.2],
                    [0.3, 0.4],
                    [0.5, 0.6],
                ],
            }),
        } as any;
        const mockIndex = { upsert: vi.fn().mockResolvedValue(undefined) } as any;

        const emails = [
            { accountId: 1, messageId: 'msg-a', text: 'email one' },
            { accountId: 1, messageId: 'msg-b', text: 'email two' },
            { accountId: 1, messageId: 'msg-c', text: 'email three' },
        ];

        await indexEmailsBatch(mockIndex, mockAi, emails);

        // Only 1 AI call with all texts batched
        expect(mockAi.run).toHaveBeenCalledTimes(1);
        expect(mockAi.run.mock.calls[0][1].text).toHaveLength(3);

        // Only 1 upsert call with all vectors
        expect(mockIndex.upsert).toHaveBeenCalledTimes(1);
        expect(mockIndex.upsert.mock.calls[0][0]).toHaveLength(3);
    });

    it('caps batch at MAX_BATCH_SIZE (20)', async () => {
        const emails = Array.from({ length: 25 }, (_, i) => ({
            accountId: 1,
            messageId: `msg-${i}`,
            text: `email ${i}`,
        }));
        const embeddings = Array.from({ length: 20 }, (_, i) => [i * 0.1]);
        const mockAi = {
            run: vi.fn().mockResolvedValue({ data: embeddings }),
        } as any;
        const mockIndex = { upsert: vi.fn().mockResolvedValue(undefined) } as any;

        await indexEmailsBatch(mockIndex, mockAi, emails);

        expect(mockAi.run.mock.calls[0][1].text).toHaveLength(20);
        expect(mockIndex.upsert.mock.calls[0][0]).toHaveLength(20);
    });
});

describe('searchSimilar', () => {
    it('returns empty array when vectorIndex is undefined', async () => {
        const result = await searchSimilar(undefined, undefined, 'test query');
        expect(result).toEqual([]);
    });

    it('queries with correct parameters', async () => {
        const mockAi = {
            run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }),
        } as any;
        const mockIndex = {
            query: vi.fn().mockResolvedValue({
                matches: [{ score: 0.9, metadata: { account_id: 1, message_id: 'msg1' } }],
            }),
        } as any;

        const results = await searchSimilar(mockIndex, mockAi, 'flights', 5, [1]);

        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ accountId: 1, messageId: 'msg1', score: 0.9 });
        expect(mockIndex.query).toHaveBeenCalledWith(
            [0.1, 0.2],
            expect.objectContaining({ topK: 5, filter: { account_id: 1 } })
        );
    });
});

describe('deleteFromIndex', () => {
    it('gracefully skips when vectorIndex is undefined', async () => {
        await deleteFromIndex(undefined, 1, 'msg1');
        // Should not throw
    });

    it('calls deleteByIds with correct composite ID', async () => {
        const mockIndex = { deleteByIds: vi.fn().mockResolvedValue(undefined) } as any;
        await deleteFromIndex(mockIndex, 42, 'msg-abc');
        expect(mockIndex.deleteByIds).toHaveBeenCalledWith([
            '0aee47c066a8883b81c9dc2a9163851b8179cb0b66a8a566cd71014b37374526',
        ]);
    });
});
