import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateEmbedding, indexEmail, searchSimilar, deleteFromIndex } from './vector';

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
