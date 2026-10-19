import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import mcp from './mcp';
import app from '../app';
import type { Env } from '../types';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

it.each(['/mcp', '/mcp/', '/mcp/sse'])('rejects unsupported SSE GETs at %s without authenticating', async (path) => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await app.fetch(
        new Request(`https://example.com${path}`, {
            headers: { Accept: 'text/event-stream', Authorization: 'Bearer synthetic-invalid-token' },
        }),
        { RATE_LIMITER: {} } as Env
    );
    expect(result.status).toBe(405);
    expect(result.headers.get('Allow')).toBe('POST');
    expect(result.headers.get('X-Ezer0-Request-Id')).toBeTruthy();
    await result.body?.cancel();
});

it('serves public health independently of MCP, database access and dashboard authentication', async () => {
    const result = await app.fetch(new Request('https://example.com/health'), { RATE_LIMITER: {} } as Env);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: 'ok' });
});

it('does not reconnect when the SDK probes the unsupported SSE endpoint', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
    let requests = 0;
    const transport = new StreamableHTTPClientTransport(new URL('https://example.com/mcp'), {
        fetch: async (input, init) => {
            requests++;
            return app.fetch(new Request(input, init), { RATE_LIMITER: {} } as Env);
        },
    });
    try {
        await transport.start();
        await transport.resumeStream('synthetic-event');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(requests).toBe(1);
    } finally {
        await transport.close();
    }
});

it('does not report completion or failure when a pending provider stream is cancelled', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => logs.push(String(value)));
    mcp.post('/test-pending', () => new Response(new ReadableStream()));
    const app = new Hono<{ Bindings: Env }>().route('/mcp', mcp);
    const result = await app.fetch(new Request('https://example.com/mcp/test-pending', { method: 'POST' }), {} as Env);
    expect(result.status).toBe(200);
    await Promise.resolve();
    await result.body!.cancel();
    await Promise.resolve();
    const events = logs.map((log) => JSON.parse(log).event);
    expect(events).toContain('mcp_response_stream_cancelled');
    expect(events).not.toContain('mcp_response_completed');
    expect(events).not.toContain('mcp_response_stream_failed');
});
it('reports HTTP status/catalog/request ID and completion without leaking authorization', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => logs.push(String(value)));
    const app = new Hono<{ Bindings: Env }>().route('/mcp', mcp);
    const result = await app.fetch(new Request('https://example.com/mcp', { method: 'POST' }), {} as Env);
    expect(result.status).toBe(401);
    await result.text();
    expect(result.headers.get('X-Ezer0-Catalog-Version')).toBe('1.1.1');
    expect(result.headers.get('X-Ezer0-Request-Id')).toBeTruthy();
    expect(logs.map((log) => JSON.parse(log).event)).toContain('mcp_response_completed');
    expect(logs.join(' ')).not.toContain('Authorization');
});

it('distinguishes request abort and response cancellation without blaming a user', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => logs.push(String(value)));
    const abort = new AbortController();
    const app = new Hono<{ Bindings: Env }>().route('/mcp', mcp);
    const result = await app.fetch(new Request('https://example.com/mcp', { signal: abort.signal }), {} as Env);
    abort.abort();
    await result.body?.cancel();
    const parsed = logs.map((log) => JSON.parse(log));
    expect(parsed.some((log) => log.event === 'incoming_request_aborted')).toBe(true);
    expect(parsed.some((log) => log.event === 'mcp_response_stream_cancelled')).toBe(true);
    expect(parsed.some((log) => log.event === 'mcp_response_completed')).toBe(false);
    expect(parsed.some((log) => log.event === 'mcp_response_stream_failed')).toBe(false);
    expect(parsed.filter((log) => log.source).every((log) => log.source.includes('not_proof_of_user_action'))).toBe(
        true
    );
});
