import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftGmailReply, moveGmailToFolder, modifyGmailMessage } from './gmail';
import { draftOutlookReply, moveOutlookToFolder, markOutlookMessageRead } from './outlook';
import { assertEmailRequestAllowed } from './safety';

afterEach(() => vi.unstubAllGlobals());

describe('draft-only email management', () => {
    it.each([
        'messages/send',
        'drafts/send',
        'sendMail',
        'messages/id/send',
        'messages/id/reply',
        'messages/id/replyAll',
        'messages/id/forward',
        'messages/id/%73end/',
    ])('blocks sending via %s', (path) => {
        expect(() => assertEmailRequestAllowed(`https://example.com/${path}`)).toThrow('Sending email is disabled');
    });

    it('creates a threaded Gmail reply draft with UTF-8 body and Reply-To', async () => {
        const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('?format=metadata'))
                return Response.json({
                    threadId: 'thread-1',
                    payload: {
                        headers: [
                            { name: 'From', value: 'sender@example.com' },
                            { name: 'Reply-To', value: 'reply@example.com' },
                            { name: 'Subject', value: 'Original subject' },
                            { name: 'Message-ID', value: '<parent@example.com>' },
                            { name: 'References', value: '<ancestor@example.com>' },
                        ],
                    },
                });
            expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/drafts');
            expect(init?.method).toBe('POST');
            const payload = JSON.parse(init?.body as string);
            expect(payload.message.threadId).toBe('thread-1');
            const mime = atob(payload.message.raw.replace(/-/g, '+').replace(/_/g, '/'));
            expect(mime).toContain('To: reply@example.com\r\n');
            expect(mime).toContain('From: owner@example.com\r\n');
            expect(mime).toContain('Subject: Original subject\r\n');
            expect(mime).toContain('In-Reply-To: <parent@example.com>');
            expect(mime).toContain('References: <ancestor@example.com> <parent@example.com>');
            const encodedBody = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '');
            expect(new TextDecoder().decode(Uint8Array.from(atob(encodedBody), (c) => c.charCodeAt(0)))).toBe(
                'Thanks, caf\u00e9!'
            );
            return Response.json({ id: 'draft-1', message: { id: 'reply-1' } });
        });
        vi.stubGlobal('fetch', mockFetch);
        expect(await draftGmailReply('token', 'parent/id', 'Thanks, caf\u00e9!', 'owner@example.com')).toEqual({
            draft_id: 'draft-1',
            message_id: 'reply-1',
        });
        expect(mockFetch.mock.calls[0][0]).toContain('/messages/parent%2Fid?');
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it.each([undefined, 'sender@example.com\r\nBcc: attacker@example.com'])(
        'rejects missing or injected Gmail reply metadata',
        async (from) => {
            const mockFetch = vi.fn(async () =>
                Response.json({
                    threadId: 'thread-1',
                    payload: { headers: from ? [{ name: 'From', value: from }] : [] },
                })
            );
            vi.stubGlobal('fetch', mockFetch);
            await expect(draftGmailReply('token', 'id', 'reply', 'owner@example.com')).rejects.toThrow();
            expect(mockFetch).toHaveBeenCalledTimes(1);
        }
    );

    it('creates a Microsoft draft using createReply, never reply or send', async () => {
        const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
            expect(url).toBe('https://graph.microsoft.com/v1.0/me/messages/parent==/createReply');
            expect(init?.method).toBe('POST');
            expect(JSON.parse(init?.body as string)).toEqual({
                message: { body: { contentType: 'Text', content: 'Thanks!' } },
            });
            return Response.json({ id: 'draft-1', isDraft: true });
        });
        vi.stubGlobal('fetch', mockFetch);
        expect(await draftOutlookReply('token', 'parent==', 'Thanks!')).toEqual({
            draft_id: 'draft-1',
            message_id: 'draft-1',
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('propagates provider failure without falling back to sending', async () => {
        const mockFetch = vi.fn(async () => new Response('permission denied', { status: 403 }));
        vi.stubGlobal('fetch', mockFetch);
        await expect(draftOutlookReply('token', 'id', 'reply')).rejects.toThrow('Graph API error (403)');
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('removes only the selected Gmail source label and inbox', async () => {
        const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/labels'))
                return Response.json({
                    labels: [
                        { id: 'Label_old', name: 'Old' },
                        { id: 'Label_new', name: 'New' },
                    ],
                });
            expect(url).toContain('/messages/id/modify');
            expect(JSON.parse(init?.body as string)).toEqual({
                addLabelIds: ['Label_new'],
                removeLabelIds: ['INBOX', 'Label_old'],
            });
            return Response.json({});
        });
        vi.stubGlobal('fetch', mockFetch);
        await moveGmailToFolder('token', 'id', 'New', 'Old');
    });

    it('does not remove a Gmail destination that is also the source', async () => {
        const mockFetch = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/labels')) return Response.json({ labels: [{ id: 'Label_same', name: 'Same' }] });
            expect(JSON.parse(init?.body as string)).toEqual({
                addLabelIds: ['Label_same'],
                removeLabelIds: ['INBOX'],
            });
            return Response.json({});
        });
        vi.stubGlobal('fetch', mockFetch);
        await moveGmailToFolder('token', 'id', 'Same', 'Same');
    });

    it('returns the new Microsoft message ID after a manual move', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (_url: string, init?: RequestInit) => {
                expect(JSON.parse(init?.body as string)).toEqual({ destinationId: 'archive' });
                return Response.json({ id: 'moved-id' });
            })
        );
        expect(await moveOutlookToFolder('token', 'old-id', 'Archive')).toEqual({
            action: 'moved',
            folder: 'archive',
            message_id: 'moved-id',
        });
    });

    it.each([true, false])('continues supporting read/unread (%s) on both providers', async (isRead) => {
        const mockFetch = vi.fn(async () => Response.json({}));
        vi.stubGlobal('fetch', mockFetch);
        await modifyGmailMessage('token', 'id', isRead ? [] : ['UNREAD'], isRead ? ['UNREAD'] : []);
        await markOutlookMessageRead('token', 'id', isRead);
        expect(JSON.parse(mockFetch.mock.calls[0][1]?.body as string)).toEqual({
            addLabelIds: isRead ? [] : ['UNREAD'],
            removeLabelIds: isRead ? ['UNREAD'] : [],
        });
        expect(JSON.parse(mockFetch.mock.calls[1][1]?.body as string)).toEqual({ isRead });
    });
});
