import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyRuleToExistingGmail } from './gmail';
import { applyRuleToExistingOutlook } from './outlook';

describe('retroactive email rule application search query construction', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('quotes Gmail condition values before applying bulk actions', async () => {
        const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('/messages?')) {
                return Response.json({ messages: [{ id: 'message-1' }] });
            }

            expect(url).toContain('/messages/batchModify');
            expect(init?.method).toBe('POST');
            return Response.json({});
        });
        vi.stubGlobal('fetch', mockFetch);

        await applyRuleToExistingGmail(
            'token',
            {
                from: ['attacker@example.com) OR label:inbox OR from:(nobody@example.com'],
                subject: ['quarterly report'],
                body: ['has:attachment OR is:unread'],
            },
            { delete: true, markAsRead: true }
        );

        const searchUrl = new URL(mockFetch.mock.calls[0][0]);
        expect(searchUrl.searchParams.get('q')).toBe(
            'from:"attacker@example.com) OR label:inbox OR from:(nobody@example.com" subject:"quarterly report" "has:attachment OR is:unread"'
        );
        expect(mockFetch.mock.calls[1][1]?.body).toBe(
            JSON.stringify({ ids: ['message-1'], addLabelIds: ['TRASH'], removeLabelIds: ['UNREAD'] })
        );
    });

    it('quotes Outlook condition values before applying matched actions', async () => {
        const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('/messages?$search=')) {
                return Response.json({ value: [{ id: 'message-1' }] });
            }

            expect(url).toContain('/messages/message-1');
            expect(init?.method).toBe('PATCH');
            return Response.json({});
        });
        vi.stubGlobal('fetch', mockFetch);

        await applyRuleToExistingOutlook(
            'token',
            {
                from: ['attacker@example.com) OR subject:password OR from:(nobody@example.com'],
                subject: ['quarterly report'],
                body: ['hasattachment:true OR isread:false'],
            },
            { markAsRead: true }
        );

        const searchUrl = new URL(mockFetch.mock.calls[0][0]);
        expect(searchUrl.searchParams.get('$search')).toBe(
            '"from:"attacker@example.com) OR subject:password OR from:(nobody@example.com" AND subject:"quarterly report" AND "hasattachment:true OR isread:false""'
        );
    });
});
