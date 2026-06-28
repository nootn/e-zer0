import { afterEach, describe, expect, it, vi } from 'vitest';

import { deleteGmailFilter } from './gmail';

describe('Gmail API path handling', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('encodes filter IDs before placing them in DELETE paths', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({}),
        });
        vi.stubGlobal('fetch', fetchMock);

        await deleteGmailFilter('token', '../../messages/msg-123');

        expect(fetchMock).toHaveBeenCalledWith(
            'https://gmail.googleapis.com/gmail/v1/users/me/settings/filters/..%2F..%2Fmessages%2Fmsg-123',
            expect.objectContaining({ method: 'DELETE' })
        );
    });
});
