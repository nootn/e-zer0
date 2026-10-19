import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteGmailFilter, listGmailFilters, listGmailMessages, searchGmailMessages } from './gmail';

function metadataBatchResponse(ids: string[], status = 200): Response {
    const parts = ids.map((id) =>
        [
            '--response-boundary',
            'Content-Type: application/http',
            '',
            `HTTP/1.1 ${status} Status`,
            'Content-Type: application/json',
            '',
            JSON.stringify({ id, threadId: id, payload: { headers: [{ name: 'Subject', value: id }] } }),
        ].join('\r\n')
    );
    return new Response([...parts, '--response-boundary--'].join('\r\n'), {
        headers: { 'Content-Type': 'multipart/mixed; boundary="response-boundary"' },
    });
}

describe('Gmail API path handling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('encodes filter IDs before placing them in DELETE paths', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
        vi.stubGlobal('fetch', fetchMock);

        await deleteGmailFilter('token', '../../messages/msg-123');

        expect(fetchMock).toHaveBeenCalledWith(
            'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters/..%2F..%2Fmessages%2Fmsg-123',
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    it.each([200, 204])('accepts an empty successful filter-delete response (%s) without retrying', async (status) => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(deleteGmailFilter('token', 'filter-id')).resolves.toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still parses non-empty successful JSON responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ filter: [{ id: 'filter-id' }] })));
        await expect(listGmailFilters('token')).resolves.toEqual([{ id: 'filter-id' }]);
    });

    it('does not hide malformed JSON or unsuccessful deletes', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response('{', { status: 200 }))
            .mockResolvedValueOnce(new Response('permission denied', { status: 403 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(listGmailFilters('token')).rejects.toBeInstanceOf(SyntaxError);
        await expect(deleteGmailFilter('token', 'filter-id')).rejects.toThrow('Gmail API error (403)');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['recent', 'filtered'])(
        'reads 50 %s messages in sequential batches of ten with stable ordering',
        async (reader) => {
            const ids = Array.from({ length: 50 }, (_, i) => `msg-${i}`);
            let active = 0;
            let peak = 0;
            const sizes: number[] = [];
            const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
                if (new URL(url).pathname.endsWith('/messages')) {
                    return Response.json({ messages: ids.map((id) => ({ id })) });
                }
                active++;
                peak = Math.max(peak, active);
                expect(url).toBe('https://gmail.googleapis.com/batch/gmail/v1');
                expect(options?.method).toBe('POST');
                const batchIds = [
                    ...String(options?.body).matchAll(/GET \/gmail\/v1\/users\/me\/messages\/([^?]+)\?/g),
                ].map((match) => decodeURIComponent(match[1]));
                sizes.push(batchIds.length);
                await new Promise((resolve) => setTimeout(resolve, 0));
                active--;
                return metadataBatchResponse(batchIds);
            });
            vi.stubGlobal('fetch', fetchMock);

            const messages =
                reader === 'recent'
                    ? await listGmailMessages('token', 50)
                    : await searchGmailMessages('token', { count: 50 });

            expect(messages.map((message) => message.id)).toEqual(ids);
            expect(messages.map((message) => message.subject)).toEqual(ids);
            expect(fetchMock).toHaveBeenCalledTimes(6);
            expect(sizes).toEqual([10, 10, 10, 10, 10]);
            expect(peak).toBe(1);
        }
    );

    it('stops scheduling later metadata groups when Gmail rejects a read', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                Response.json({ messages: Array.from({ length: 50 }, (_, i) => ({ id: `msg-${i}` })) })
            )
            .mockImplementation(async () => new Response('rate limited', { status: 429 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(searchGmailMessages('token', { count: 50 })).rejects.toThrow('Gmail API error (429)');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each(['part-error', 'missing-part', 'wrong-id', 'malformed', 'missing-boundary'])(
        'rejects a %s batch instead of returning partial results',
        async (failure) => {
            let response = metadataBatchResponse(['msg-0']);
            if (failure === 'part-error') response = metadataBatchResponse(['msg-0'], 429);
            if (failure === 'missing-part') response = metadataBatchResponse([]);
            if (failure === 'wrong-id') response = metadataBatchResponse(['other-id']);
            if (failure === 'malformed')
                response = new Response('--response-boundary\r\ninvalid\r\n--response-boundary--', {
                    headers: { 'Content-Type': 'multipart/mixed; boundary=response-boundary' },
                });
            if (failure === 'missing-boundary') response = Response.json({});
            const fetchMock = vi
                .fn()
                .mockResolvedValueOnce(Response.json({ messages: [{ id: 'msg-0' }] }))
                .mockResolvedValueOnce(response);
            vi.stubGlobal('fetch', fetchMock);
            await expect(searchGmailMessages('token', { count: 50 })).rejects.toThrow();
            expect(fetchMock).toHaveBeenCalledTimes(2);
        }
    );
});
