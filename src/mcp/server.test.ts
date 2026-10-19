import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Env } from '../types';
import { encrypt } from '../lib/crypto';
import { createMcpServer } from './server';

afterEach(() => vi.unstubAllGlobals());

it('advertises accurate read/write annotations for every tool', async () => {
    const server = createMcpServer({} as Env, 'client', 'Test');
    const client = new Client({ name: 'test', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
        const { tools } = await client.listTools();
        const readTools = new Set([
            'list_calendar_accounts',
            'list_calendars',
            'get_calendar_events',
            'list_connected_accounts',
            'read_recent_emails',
            'get_emails',
            'list_folders',
            'search_emails_semantic',
            'list_email_rules',
            'list_task_lists',
            'list_tasks',
            'list_email_labels',
            'get_email',
            'search_email_page',
            'preview_email_rule',
        ]);
        expect(tools).toHaveLength(27);
        const emailSchema = tools.find((tool) => tool.name === 'get_emails')?.inputSchema;
        expect(emailSchema?.properties?.page_token).toMatchObject({
            type: 'string',
            description: expect.stringContaining('Follow next_page_token until exhausted is true'),
        });
        expect(emailSchema?.required || []).not.toContain('page_token');
        for (const tool of tools) {
            expect(tool.annotations?.readOnlyHint, tool.name).toBe(readTools.has(tool.name));
            expect(tool.annotations?.openWorldHint, tool.name).toBe(false);
            expect(typeof tool.annotations?.destructiveHint, tool.name).toBe('boolean');
            if (readTools.has(tool.name)) expect(tool.annotations?.destructiveHint).toBe(false);
        }
        expect(tools.find((tool) => tool.name === 'draft_email_reply')?.annotations?.destructiveHint).toBe(false);
        expect(tools.find((tool) => tool.name === 'delete_task')?.annotations?.destructiveHint).toBe(true);
        expect(tools.find((tool) => tool.name === 'create_email_rule')?.annotations?.destructiveHint).toBe(true);
    } finally {
        await client.close();
        await server.close();
    }
});

it.each(['google', 'microsoft', 'denied', 'failure'] as const)(
    'enforces mailbox grants and audits draft requests (%s)',
    async (scenario) => {
        const key = '01'.repeat(32);
        const token = await encrypt('test-token', key);
        const audits: unknown[][] = [];
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
                            if (sql.includes('mcp_client_accounts')) {
                                expect(values).toEqual(['client-1', 1]);
                                return scenario === 'denied' ? null : { permitted: 1 };
                            }
                            return {
                                id: 1,
                                email_address: 'owner@example.com',
                                provider: scenario === 'google' ? 'google' : 'microsoft',
                                encrypted_access_token: token,
                            };
                        },
                        async run() {
                            audits.push(values);
                            return {};
                        },
                    };
                },
            },
        } as unknown as Env;
        const mockFetch = vi.fn(async (url: string) => {
            if (scenario === 'failure') return new Response('private reply body', { status: 403 });
            if (url.includes('?format=metadata'))
                return Response.json({
                    threadId: 'thread-1',
                    payload: {
                        headers: [
                            { name: 'From', value: 'sender@example.com' },
                            { name: 'Message-ID', value: '<parent@example.com>' },
                            { name: 'Subject', value: 'subject' },
                        ],
                    },
                });
            return Response.json(
                scenario === 'google' ? { id: 'draft-1', message: { id: 'reply-1' } } : { id: 'draft-1', isDraft: true }
            );
        });
        vi.stubGlobal('fetch', mockFetch);
        const server = createMcpServer(env, 'client-1', 'Test client');
        const client = new Client({ name: 'test', version: '1' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        await client.connect(clientTransport);
        try {
            const { tools } = await client.listTools();
            expect(tools.map((tool) => tool.name)).toContain('draft_email_reply');
            expect(tools.some((tool) => /send|forward/.test(tool.name))).toBe(false);
            const result = await client.callTool({
                name: 'draft_email_reply',
                arguments: { account_id: 1, message_id: 'parent', body: 'private reply body' },
            });
            const failed = scenario === 'denied' || scenario === 'failure';
            expect(Boolean(result.isError)).toBe(failed);
            expect(audits).toHaveLength(1);
            expect(audits[0].slice(0, 4)).toEqual(['client-1', 'Test client', 'draft_email_reply', 'account:1:parent']);
            expect(audits[0][5]).toBe(failed ? 0 : 1);
            expect(JSON.stringify(audits)).not.toContain('private reply body');
            if (scenario === 'denied') expect(mockFetch).not.toHaveBeenCalled();
            const invalid = await client.callTool({
                name: 'draft_email_reply',
                arguments: { account_id: 1, message_id: 'parent', body: '   ' },
            });
            expect(invalid.isError).toBe(true);
            expect(audits).toHaveLength(1);
        } finally {
            await client.close();
            await server.close();
        }
    }
);
