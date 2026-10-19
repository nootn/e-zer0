import { afterEach, expect, it, vi } from 'vitest';
import { listGmailFilters, createGmailLabel, createGmailFilter, getGmailMessage } from './gmail';
import {
    planGmailChanges,
    previewGmailRule,
    applyGmailPreview,
    createGmailFilterSafely,
    gmailRuleQuery,
} from './label-rules';
import { encrypt, decrypt } from '../crypto';
import { listGmailMessagePage } from './gmail';
import { listOutlookMessagePage } from './outlook';
import { deleteOutlookRule } from './outlook';

afterEach(() => vi.unstubAllGlobals());
const jira = 'jira@example.com';
const message = (id: string, body: string, from = jira) => ({
    id,
    threadId: id,
    from,
    to: 'owner@example.com',
    subject: 'Issue updated',
    date: '',
    snippet: '',
    body,
    body_complete: true,
    is_calendar: false,
    labels: ['INBOX', 'UNREAD'],
});

it('labels Jira mentions but archives only reviewed routine updates without marking read', () => {
    const actions = { addLabels: ['Label_ExampleCo'], archive: true };
    for (const body of ['mentioned you', '@Alex Morgan', 'Assigned to Alex', 'Alex was tagged']) {
        expect(planGmailChanges(message('mention', body), actions, ['Alex', 'mentioned you']).removeLabelIds).toEqual(
            []
        );
    }
    expect(
        planGmailChanges(message('routine', 'Status changed from open to closed'), actions, ['Alex']).removeLabelIds
    ).toEqual(['INBOX']);
});

it('newsletters gain only a label; calendar and incomplete bodies are untouched', () => {
    const newsletter = message('build', 'The Example Newsletter', 'newsletter@example.com');
    expect(planGmailChanges(newsletter, { addLabels: ['Label_News'] }, [])).toMatchObject({
        addLabelIds: ['Label_News'],
        removeLabelIds: [],
    });
    for (const m of [
        { ...newsletter, is_calendar: true },
        { ...newsletter, body_complete: false },
    ]) {
        expect(planGmailChanges(m, { addLabels: ['Label_News'], archive: true }, [])).toMatchObject({
            addLabelIds: [],
            removeLabelIds: [],
        });
    }
});

it.each([undefined, {}, { filter: [] }])('handles missing and empty rule results', async (result) => {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(result === undefined ? new Response(null, { status: 204 }) : Response.json(result))
    );
    await expect(listGmailFilters('token')).resolves.toEqual([]);
});

it('reconciles uncertain label creation and reuses the stable ID on retry', async () => {
    let created = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            created = true;
            throw new Error('connection lost');
        }
        return Response.json({ labels: created ? [{ id: 'Label_1', name: 'business/ExampleCo', type: 'user' }] : [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await createGmailLabel('token', 'business/ExampleCo')).id).toBe('Label_1');
    expect((await createGmailLabel('token', 'business/ExampleCo')).id).toBe('Label_1');
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1);
});

it('reconciles uncertain filter creation without repeating POST', async () => {
    const criteria = { from: jira };
    const action = { addLabelIds: ['Label_1'] };
    let created = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
            created = true;
            throw new Error('connection lost');
        }
        return Response.json({ filter: created ? [{ id: 'filter-1', criteria, action }] : [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await createGmailFilter('token', criteria, action)).id).toBe('filter-1');
    expect((await createGmailFilter('token', criteria, action)).id).toBe('filter-1');
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1);
});

it('accepts Outlook empty successful deletes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(deleteOutlookRule('token', 'rule-1')).resolves.toBeUndefined();
});

it('decodes nested UTF-8 MIME bodies and detects calendar attachments without writes', async () => {
    const data = btoa(String.fromCharCode(...new TextEncoder().encode('Alex — mentioned you')))
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
            id: 'm',
            payload: {
                headers: [],
                parts: [
                    { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data } }] },
                    { mimeType: 'text/calendar', filename: 'invite.ics' },
                ],
            },
            labelIds: ['UNREAD', 'INBOX'],
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await getGmailMessage('token', 'm')).toMatchObject({
        body: 'Alex — mentioned you',
        body_complete: true,
        is_calendar: true,
        labels: ['UNREAD', 'INBOX'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('previews a page read-only, rejects unrelated/calendar mail and applies only reviewed IDs with retry reconciliation', async () => {
    const bodies = [
        message('routine', 'Status updated'),
        message('mention', 'mentioned you'),
        message('security', 'Security alert', 'security@example.com'),
        { ...message('calendar', 'Invitation'), is_calendar: true },
    ];
    const state = new Map(bodies.map((m) => [m.id, { ...m }]));
    const writes: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/messages?'))
            return Response.json({ messages: bodies.map((m) => ({ id: m.id })), nextPageToken: 'next' });
        if (url.endsWith('/labels'))
            return Response.json({ labels: [{ id: 'Label_ExampleCo', name: 'business/ExampleCo', type: 'user' }] });
        const id = decodeURIComponent(
            new URL(url).pathname
                .split('/')
                .filter(Boolean)
                .at(init?.method === 'POST' ? -2 : -1)!
        );
        const m = state.get(id)!;
        if (init?.method === 'POST') {
            const action = JSON.parse(String(init.body));
            writes.push(id);
            m.labels = [
                ...new Set([...m.labels.filter((l) => !action.removeLabelIds.includes(l)), ...action.addLabelIds]),
            ];
            throw new Error('response lost after write');
        }
        return Response.json({
            id,
            threadId: id,
            labelIds: m.labels,
            payload: {
                headers: [
                    { name: 'From', value: m.from },
                    { name: 'Subject', value: m.subject },
                ],
                mimeType: m.is_calendar ? 'text/calendar' : 'text/plain',
                body: { data: btoa(m.body!) },
            },
        });
    });
    vi.stubGlobal('fetch', fetchMock);
    const key = '01'.repeat(32);
    const preview = await previewGmailRule(
        'token',
        key,
        'client',
        1,
        { from: [jira] },
        { addLabels: ['business/ExampleCo'], archive: true },
        ['Alex', 'mentioned you'],
        5
    );
    expect(writes).toEqual([]);
    expect(preview.next_page_token).toBe('next');
    expect(preview.messages.find((m) => m.id === 'mention')?.removeLabelIds).toEqual([]);
    expect(preview.messages.filter((m) => m.addLabelIds.length)).toHaveLength(2);
    const result = await applyGmailPreview('token', key, 'client', 1, preview.preview_token, ['routine', 'mention']);
    expect(result.results.every((r) => r.status === 'reconciled')).toBe(true);
    await applyGmailPreview('token', key, 'client', 1, preview.preview_token, ['routine', 'mention']);
    expect(writes).toEqual(['routine', 'mention']);
    expect(state.get('routine')?.labels).toEqual(['UNREAD', 'Label_ExampleCo']);
    expect(state.get('mention')?.labels).toEqual(['INBOX', 'UNREAD', 'Label_ExampleCo']);
    expect(state.get('security')?.labels).toEqual(['INBOX', 'UNREAD']);
    expect(state.get('calendar')?.labels).toEqual(['INBOX', 'UNREAD']);
    await expect(
        applyGmailPreview('token', key, 'another-client', 1, preview.preview_token, ['routine'])
    ).rejects.toThrow();
});

function intentDatabase(): D1Database {
    const rows = new Map<string, { owner: string; provider_id?: string }>();
    return {
        prepare(sql: string) {
            let args: unknown[] = [];
            return {
                bind(...values: unknown[]) {
                    args = values;
                    return this;
                },
                async run() {
                    if (sql.startsWith('INSERT')) {
                        const key = `${args[0]}:${args[1]}`;
                        if (!rows.has(key)) rows.set(key, { owner: String(args[2]) });
                    }
                    if (sql.startsWith('UPDATE')) {
                        const row = rows.get(`${args[1]}:${args[2]}`);
                        if (row) row.provider_id = String(args[0]);
                    }
                    if (sql.startsWith('DELETE')) {
                        for (const [key, row] of rows) {
                            if (key.startsWith(`${args[0]}:`) && row.provider_id === args[1]) rows.delete(key);
                        }
                    }
                    return {};
                },
                async first() {
                    return rows.get(`${args[0]}:${args[1]}`);
                },
            };
        },
    } as unknown as D1Database;
}

it('records a reconciled filter ID so confirmed deletion permits recreation', async () => {
    const db = intentDatabase();
    let filter: { id: string; criteria: { from: string }; action: { addLabelIds: string[] } } | undefined;
    let uncertain = true;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
            if (init?.method === 'POST') {
                if (uncertain) throw new Error('lost response');
                filter = { id: 'replacement', criteria: { from: jira }, action: { addLabelIds: ['Label_1'] } };
                return Response.json(filter);
            }
            return Response.json({ filter: filter ? [filter] : [] });
        })
    );
    const args = [db, 1, 'token', { from: jira }, { addLabelIds: ['Label_1'] }] as const;
    await expect(createGmailFilterSafely(...args)).rejects.toThrow('lost response');
    filter = { id: 'reconciled', criteria: { from: jira }, action: { addLabelIds: ['Label_1'] } };
    expect((await createGmailFilterSafely(...args)).id).toBe('reconciled');
    await db
        .prepare('DELETE FROM filter_write_intents WHERE account_id = ? AND provider_id = ?')
        .bind(1, filter.id)
        .run();
    filter = undefined;
    uncertain = false;
    expect((await createGmailFilterSafely(...args)).id).toBe('replacement');
});

it.each(['text/html', 'text/plain'])('includes named inline %s bodies in mention protection', async (mimeType) => {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
            Response.json({
                id: 'inline',
                labelIds: ['INBOX', 'UNREAD'],
                payload: {
                    mimeType,
                    filename: 'body.html',
                    headers: [{ name: 'Content-Disposition', value: 'inline; filename="body.html"' }],
                    body: { data: btoa('Alex mentioned you') },
                },
            })
        )
    );
    const message = await getGmailMessage('token', 'inline');
    expect(message.body).toContain('Alex mentioned you');
    expect(planGmailChanges(message, { archive: true }, ['Alex']).removeLabelIds).toEqual([]);
});

it('a concurrent or uncertain filter create never issues a duplicate POST', async () => {
    const db = intentDatabase();
    let posts = 0;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
            if (init?.method === 'POST') {
                posts++;
                throw new Error('lost response');
            }
            return Response.json({ filter: [] });
        })
    );
    const args = [db, 1, 'token', { from: jira }, { addLabelIds: ['Label_1'] }] as const;
    const results = await Promise.allSettled([createGmailFilterSafely(...args), createGmailFilterSafely(...args)]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    await expect(createGmailFilterSafely(...args)).rejects.toThrow('pending or uncertain');
    expect(posts).toBe(1);
});

it('supports native exclusions and encoded Gmail pagination without writes', async () => {
    expect(gmailRuleQuery({ from: [jira], query: 'in:inbox', negatedQuery: '"mentioned you" OR "@Alex Morgan"' })).toBe(
        `from:"${jira}" (in:inbox) -("mentioned you" OR "@Alex Morgan")`
    );
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ messages: [{ id: '1' }], nextPageToken: 'page+2' }))
        .mockResolvedValueOnce(Response.json({ messages: [{ id: '2' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await listGmailMessagePage('token', 'in:inbox', 5);
    const last = await listGmailMessagePage('token', 'in:inbox', 5, first.next_page_token);
    expect(last).toEqual({ message_ids: ['2'], next_page_token: undefined });
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('pageToken')).toBe('page+2');
});

it('newsletter previews change only the exact sender/subject and never security or calendar mail', async () => {
    const fixtures = [
        {
            ...message('newsletter', 'Monthly newsletter', 'newsletter@example.com'),
            subject: 'The Example Newsletter - October',
        },
        { ...message('security', 'Protect your account', 'newsletter@example.com'), subject: 'Security alert' },
        { ...message('other-sender', 'Monthly newsletter', 'security@example.com'), subject: 'The Example Newsletter' },
        {
            ...message('calendar', 'Invitation', 'newsletter@example.com'),
            subject: 'The Example Newsletter',
            is_calendar: true,
        },
    ];
    const writes: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('/messages?')) return Response.json({ messages: fixtures.map((m) => ({ id: m.id })) });
            if (url.endsWith('/labels'))
                return Response.json({ labels: [{ id: 'Label_News', name: 'newsletters', type: 'user' }] });
            const id = new URL(url).pathname.split('/').at(init?.method === 'POST' ? -2 : -1)!;
            if (init?.method === 'POST') {
                writes.push(id);
                const action = JSON.parse(String(init.body));
                expect(action).toEqual({ addLabelIds: ['Label_News'], removeLabelIds: [] });
                return new Response(null, { status: 204 });
            }
            const m = fixtures.find((f) => f.id === id)!;
            return Response.json({
                id,
                labelIds: m.labels,
                payload: {
                    mimeType: m.is_calendar ? 'text/calendar' : 'text/plain',
                    headers: [
                        { name: 'From', value: m.from },
                        { name: 'Subject', value: m.subject },
                    ],
                    body: { data: btoa(m.body!) },
                },
            });
        })
    );
    const key = '01'.repeat(32);
    const preview = await previewGmailRule(
        'token',
        key,
        'client',
        1,
        { from: ['newsletter@example.com'], subject: ['The Example Newsletter'] },
        { addLabels: ['newsletters'] },
        [],
        5
    );
    expect(preview.messages.filter((m) => m.addLabelIds.length).map((m) => m.id)).toEqual(['newsletter']);
    await applyGmailPreview(
        'token',
        key,
        'client',
        1,
        preview.preview_token,
        fixtures.map((m) => m.id)
    );
    expect(writes).toEqual(['newsletter']);
});

it('does not assume an unavailable inventory proves a filter absent when reconciling writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createGmailFilter('token', { from: jira }, { addLabelIds: ['Label_1'] })).rejects.toThrow(
        'inventory unavailable'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('preserves the original uncertain POST failure when a reconciliation GET is rate limited', async () => {
    const db = intentDatabase();
    const prepare = vi.spyOn(db, 'prepare');
    let posts = 0;
    let getFailure = false;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init?: RequestInit) => {
            if (init?.method === 'POST') {
                posts++;
                getFailure = true;
                throw new Error('POST outcome unknown');
            }
            if (getFailure) {
                getFailure = false;
                return new Response('quota', { status: 429 });
            }
            return Response.json({ filter: [] });
        })
    );
    const args = [db, 1, 'token', { from: jira }, { addLabelIds: ['Label_1'] }] as const;
    await expect(createGmailFilterSafely(...args)).rejects.toThrow('POST outcome unknown');
    expect(prepare.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false);
    await expect(createGmailFilterSafely(...args)).rejects.toThrow('pending or uncertain');
    expect(posts).toBe(1);
});

it.each([
    'mentioned&nbsp;you',
    '@&#65;lex Morgan',
    '@&#x41;lex',
    'men<span>tioned</span> you',
    'mentioned<br>you',
    '<p>mentioned</p><p>you</p>',
    'mentioned<div>you</div>',
])('keeps HTML-encoded known mentions in INBOX (%s)', (body) => {
    expect(
        planGmailChanges(message('m', body), { addLabels: ['Label_1'], archive: true }, ['Alex']).removeLabelIds
    ).toEqual([]);
});

it.each(['Alex Morgan', 'Sam Taylor'])(
    'protects caller-configured names rather than a fixed recipient (%s)',
    (name) => {
        expect(planGmailChanges(message('m', `Assigned to ${name}`), { archive: true }, [name]).removeLabelIds).toEqual(
            []
        );
        expect(planGmailChanges(message('m', `Assigned to ${name}`), { archive: true }, []).removeLabelIds).toEqual([
            'INBOX',
        ]);
    }
);

it('marks unsupported attachment-backed body content incomplete', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
            Response.json({
                id: 'm',
                payload: { mimeType: 'application/unknown', headers: [], body: { attachmentId: 'body', size: 42 } },
            })
        )
    );
    expect((await getGmailMessage('token', 'm')).body_complete).toBe(false);
});

it('supports Outlook pagination and rejects forged credential destinations', async () => {
    const next = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=5';
    const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ value: [{ id: '1' }], '@odata.nextLink': next }))
        .mockResolvedValueOnce(Response.json({ value: [{ id: '2' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const first = await listOutlookMessagePage('token', 5);
    expect((await listOutlookMessagePage('token', 5, first.next_page_token)).message_ids).toEqual(['2']);
    await expect(listOutlookMessagePage('token', 5, 'https://evil.example/me/messages')).rejects.toThrow(
        'Invalid Outlook'
    );
    await expect(
        listOutlookMessagePage('token', 5, 'https://graph.microsoft.com/v1.0/users/another/messages')
    ).rejects.toThrow('Invalid Outlook');
    expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('reports partial application, rejects stale labels and expired plans, and does not repeat uncertain writes', async () => {
    const key = '01'.repeat(32);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/messages?')) return Response.json({ messages: [{ id: 'ok' }, { id: 'failed' }] });
        if (url.endsWith('/labels')) return Response.json({ labels: [{ id: 'Label_1', name: 'label', type: 'user' }] });
        if (init?.method === 'POST') {
            if (url.includes('/failed/')) throw new Error('provider unavailable');
            return new Response(null, { status: 204 });
        }
        const id = new URL(url).pathname.split('/').at(-1);
        return Response.json({
            id,
            labelIds: ['INBOX', 'UNREAD'],
            payload: {
                mimeType: 'text/plain',
                headers: [{ name: 'From', value: jira }],
                body: { data: btoa('Routine update') },
            },
        });
    });
    vi.stubGlobal('fetch', fetchMock);
    const preview = await previewGmailRule(
        'token',
        key,
        'client',
        1,
        { from: [jira] },
        { addLabels: ['label'] },
        [],
        5
    );
    const result = await applyGmailPreview('token', key, 'client', 1, preview.preview_token, ['ok', 'failed']);
    expect(result.success).toBe(false);
    expect(result.results.map((r) => r.status)).toEqual(['applied', 'failed']);
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(2);
    const payload = JSON.parse(await decrypt(preview.preview_token, key));
    payload.expires = Date.now() - 1;
    await expect(
        applyGmailPreview('token', key, 'client', 1, await encrypt(JSON.stringify(payload), key), ['ok'])
    ).rejects.toThrow('expired');
    payload.expires = Date.now() + 60_000;
    payload.messages[0].before = [];
    const stale = await applyGmailPreview('token', key, 'client', 1, await encrypt(JSON.stringify(payload), key), [
        'ok',
    ]);
    expect(stale.results[0].error).toContain('labels/read state changed');
});
