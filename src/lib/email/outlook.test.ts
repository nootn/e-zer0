import { afterEach, expect, it, vi } from 'vitest';
import { searchOutlookMessagePage } from './outlook';

afterEach(() => vi.unstubAllGlobals());

it('reports a full final page as exhausted and normalises offset date windows', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, init?: RequestInit) => {
            expect(init?.method || 'GET').toBe('GET');
            const filter = new URL(input).searchParams.get('$filter');
            expect(filter).toContain('receivedDateTime ge 2026-01-01T00:00:00.000Z');
            expect(filter).toContain('receivedDateTime le 2026-01-03T00:00:00.000Z');
            return Response.json({
                value: Array.from({ length: 50 }, (_, i) => ({
                    id: String(i),
                    isRead: false,
                    inferenceClassification: 'other',
                    receivedDateTime: '2026-01-02T00:00:00Z',
                })),
            });
        })
    );
    const result = await searchOutlookMessagePage('token', {
        count: 50,
        folder: 'other',
        after: '2026-01-01T10:00:00+10:00',
        before: '2026-01-03T10:00:00+10:00',
    });
    expect(result.messages).toHaveLength(50);
    expect(result.exhausted).toBe(true);
    expect(result.next_page_token).toBeUndefined();
});

it('does not claim exhaustion for a malformed successful provider response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({})));
    await expect(searchOutlookMessagePage('token', { count: 50 })).rejects.toThrow('Invalid Outlook message page');
});

it('validates date ranges and counts before requesting mail', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const options of [
        { count: NaN },
        { count: 1, after: 'invalid' },
        { count: 1, after: '2026-02-01', before: '2026-01-01' },
    ]) {
        await expect(searchOutlookMessagePage('token', options)).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
});

it.each(['inbox', 'other', 'focused'])(
    'constructs ordered filter-only %s reads with and without unread status',
    async (folder) => {
        for (const is_read of [undefined, false]) {
            const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
                const url = new URL(input);
                expect(url.pathname).toBe('/v1.0/me/mailFolders/inbox/messages');
                expect(url.searchParams.has('$search')).toBe(false);
                expect(url.searchParams.get('$orderby')).toBe('receivedDateTime desc');
                expect(url.searchParams.get('$filter')).toMatch(/^receivedDateTime /);
                expect(url.searchParams.get('$filter')?.includes('isRead eq false')).toBe(is_read === false);
                expect(url.searchParams.get('$top')).toBe('50');
                expect(url.searchParams.get('$select')).toContain('inferenceClassification');
                expect(init?.method || 'GET').toBe('GET');
                return Response.json({
                    value: [
                        {
                            id: 'unread',
                            isRead: false,
                            inferenceClassification: folder === 'focused' ? 'focused' : 'other',
                            receivedDateTime: '2026-01-01T00:00:00Z',
                        },
                        {
                            id: 'read',
                            isRead: true,
                            inferenceClassification: folder === 'focused' ? 'focused' : 'other',
                            receivedDateTime: '2026-01-01T00:00:00Z',
                        },
                    ],
                });
            });
            vi.stubGlobal('fetch', fetchMock);
            const page = await searchOutlookMessagePage('token', { folder, is_read, count: 100 });
            expect(page.exhausted).toBe(true);
            expect(page.messages.map((m) => m.isRead)).toEqual(is_read === false ? [false] : [false, true]);
            expect(
                page.messages.every((m) => m.inferenceClassification === (folder === 'focused' ? 'focused' : 'other'))
            ).toBe(true);
        }
    }
);

it('keeps search separate from filters and validates classification/read status locally', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, init?: RequestInit) => {
            const url = new URL(input);
            expect(url.searchParams.has('$search')).toBe(true);
            expect(url.searchParams.has('$filter')).toBe(false);
            expect(url.searchParams.has('$orderby')).toBe(false);
            expect(init?.method || 'GET').toBe('GET');
            return Response.json({
                value: [
                    {
                        id: 'match',
                        inferenceClassification: 'other',
                        isRead: false,
                        receivedDateTime: '2026-01-02T00:00:00Z',
                    },
                    { id: 'focused', inferenceClassification: 'focused', isRead: false },
                    { id: 'read', inferenceClassification: 'other', isRead: true },
                ],
            });
        })
    );
    const page = await searchOutlookMessagePage('token', {
        folder: 'other',
        is_read: false,
        subject: 'Example',
        count: 50,
    });
    expect(page.messages.map((m) => [m.id, m.isRead, m.inferenceClassification])).toEqual([['match', false, 'other']]);
});

it.each(['inbox', "('Inbox')"])(
    'follows Graph nextLink alias %s despite short/empty pages and rejects unsafe links',
    async (alias) => {
        const collection = alias === 'inbox' ? '/inbox' : alias;
        const next = `https://graph.microsoft.com/v1.0/me/mailFolders${collection}/messages?$skip=51&$top=2`;
        const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
            expect(init?.method || 'GET').toBe('GET');
            if (input === next)
                return Response.json({
                    value: [
                        {
                            id: 'older',
                            isRead: false,
                            inferenceClassification: 'other',
                            receivedDateTime: '2026-01-02T00:00:00Z',
                        },
                    ],
                });
            const url = new URL(input);
            expect(url.searchParams.get('$filter')).toContain('receivedDateTime ge 2026-01-01T00:00:00.000Z');
            expect(url.searchParams.get('$filter')).toContain('receivedDateTime le 2026-01-03T00:00:00.000Z');
            return Response.json({ value: [], '@odata.nextLink': next });
        });
        vi.stubGlobal('fetch', fetchMock);
        const options = { folder: 'other', count: 2, after: '2026-01-01', before: '2026-01-03' };
        const first = await searchOutlookMessagePage('token', options);
        expect(first.exhausted).toBe(false);
        expect(first.next_page_token).toBe(next);
        const second = await searchOutlookMessagePage('token', options, first.next_page_token);
        expect(second.messages[0].id).toBe('older');
        expect(second.exhausted).toBe(true);
        await expect(searchOutlookMessagePage('token', options, 'https://evil.example/messages')).rejects.toThrow(
            'page token'
        );
        await expect(
            searchOutlookMessagePage('token', options, 'https://graph.microsoft.com/v1.0/users/another/messages')
        ).rejects.toThrow('page token');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    }
);
