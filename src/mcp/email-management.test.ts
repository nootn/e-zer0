import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { encrypt } from '../lib/crypto';
import type { Env } from '../types';
import { createMcpServer } from './server';
import { getEmail, createEmailRule, getEmails } from './tools';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
});
async function environment(provider = 'google', permitted = true) {
    const key = '01'.repeat(32);
    const encrypted = await encrypt('provider-token', key);
    const audits: unknown[][] = [];
    let intentOwner: string | undefined;
    const env = {
        ENCRYPTION_KEY: key,
        DB: {
            prepare(sql: string) {
                let values: unknown[] = [];
                return {
                    bind(...args: unknown[]) {
                        values = args;
                        return this;
                    },
                    async first() {
                        if (sql.includes('mcp_client_accounts')) return permitted ? { allowed: 1 } : null;
                        if (sql.includes('filter_write_intents')) return intentOwner ? { owner: intentOwner } : null;
                        return {
                            id: 1,
                            provider,
                            email_address: 'owner@example.com',
                            encrypted_access_token: encrypted,
                        };
                    },
                    async run() {
                        if (sql.startsWith('INSERT INTO filter_write_intents')) intentOwner ||= String(values[2]);
                        audits.push(values);
                        return {};
                    },
                };
            },
        },
    } as unknown as Env;
    return { env, audits };
}

it.each(['google', 'microsoft'])(
    'returns query-bound continuation and authoritative exhaustion for %s',
    async (provider) => {
        const { env } = await environment(provider);
        const next =
            provider === 'google'
                ? 'gmail-next'
                : 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=51';
        const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
            expect(init?.method || 'GET').toBe('GET');
            const continued = input.includes('$skip=51') || input.includes('pageToken=gmail-next');
            return Response.json(
                provider === 'google'
                    ? { messages: [], nextPageToken: continued ? undefined : next }
                    : { value: [], '@odata.nextLink': continued ? undefined : next }
            );
        });
        vi.stubGlobal('fetch', fetchMock);
        const first = await getEmails(env, 'client', 1, { folder: 'inbox', count: 50 });
        expect(first.messages).toEqual([]);
        expect(first.exhausted).toBe(false);
        expect(first.next_page_token).not.toBe(next);
        for (const [client, account, folder] of [
            ['another', 1, 'inbox'],
            ['client', 2, 'inbox'],
            ['client', 1, 'other'],
        ] as const) {
            await expect(
                getEmails(env, client, account, { folder, count: 50, page_token: first.next_page_token })
            ).rejects.toThrow('page token');
        }
        const second = await getEmails(env, 'client', 1, {
            folder: 'inbox',
            count: 50,
            page_token: first.next_page_token,
        });
        expect(second.exhausted).toBe(true);
        expect(second.next_page_token).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    }
);

it.each(['google', 'microsoft', 'denied'])(
    'enforces provider capability and grants on new label tools (%s)',
    async (scenario) => {
        const { env, audits } = await environment(scenario, scenario !== 'denied');
        const fetchMock = vi
            .fn()
            .mockResolvedValue(Response.json({ labels: [{ id: 'Label_1', name: 'label', type: 'user' }] }));
        vi.stubGlobal('fetch', fetchMock);
        const server = createMcpServer(env, 'client', 'Test');
        const client = new Client({ name: 'test', version: '1' });
        const [ct, st] = InMemoryTransport.createLinkedPair();
        await server.connect(st);
        await client.connect(ct);
        try {
            const result = await client.callTool({ name: 'list_email_labels', arguments: { account_id: 1 } });
            expect(!!result.isError).toBe(scenario !== 'google');
            expect(fetchMock).toHaveBeenCalledTimes(scenario === 'google' ? 1 : 0);
            expect(audits.at(-1)?.[5]).toBe(scenario === 'google' ? 1 : 0);
            const first = await client.listTools();
            const second = await client.listTools();
            expect(second.tools).toEqual(first.tools); // Catalog does not mutate during request preparation.
        } finally {
            await client.close();
            await server.close();
        }
    }
);

it('rejects Gmail-only fields before any Outlook write while preserving legacy Outlook rules', async () => {
    const { env } = await environment('microsoft');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: 'rule-1' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
        createEmailRule(env, 'client', 1, 'test', { query: 'from:someone' }, { addLabels: ['label'] })
    ).rejects.toThrow('not supported for Outlook');
    expect(fetchMock).not.toHaveBeenCalled();
    await createEmailRule(env, 'client', 1, 'legacy', { from: ['sender@example.com'] }, { markAsRead: true });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
        conditions: { senderContains: ['sender@example.com'] },
        actions: { markAsRead: true },
    });
});

it('maps Gmail exclusions and independent labels without implicit archive or read changes', async () => {
    const { env } = await environment();
    let created: unknown;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/labels'))
            return Response.json({ labels: [{ id: 'Label_News', name: 'newsletters', type: 'user' }] });
        if (init?.method === 'POST') {
            created = JSON.parse(String(init.body));
            return Response.json({ id: 'rule-1' });
        }
        return Response.json({ filter: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    await createEmailRule(
        env,
        'client',
        1,
        'Example Newsletter',
        { from: ['newsletter@example.com'], subject: ['The Example Newsletter'], negatedQuery: 'filename:ics' },
        { addLabels: ['newsletters'] }
    );
    expect(created).toEqual({
        criteria: { from: 'newsletter@example.com', subject: 'The Example Newsletter', negatedQuery: 'filename:ics' },
        action: { addLabelIds: ['Label_News'], removeLabelIds: [] },
    });
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/messages'))).toBe(false);
    await expect(
        createEmailRule(env, 'client', 1, 'x', { from: ['sender'] }, { addLabels: ['newsletters'] }, true)
    ).rejects.toThrow('preview_email_rule');
});

it('permits a synthetic 68-second read without imposing a server-side timeout or marking read', async () => {
    const { env } = await environment();
    vi.useFakeTimers();
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        providerStarted = resolve;
    });
    const fetchMock = vi.fn(async () => {
        providerStarted();
        await new Promise((resolve) => setTimeout(resolve, 68_000));
        return Response.json({
            id: 'm',
            payload: { mimeType: 'text/plain', headers: [], body: { data: btoa('body') } },
        });
    });
    vi.stubGlobal('fetch', fetchMock);
    const reading = getEmail(env, 'client', 1, 'm');
    await started;
    await vi.advanceTimersByTimeAsync(68_000);
    expect(await reading).toMatchObject({ read_only: true, message: { body: 'body' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
