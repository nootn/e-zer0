import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import mcp from './mcp';
import type { Env } from '../types';

afterEach(() => vi.restoreAllMocks());

it('does not report completion or failure when a pending provider stream is cancelled', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => logs.push(String(value)));
    mcp.get('/test-pending', () => new Response(new ReadableStream()));
    const app = new Hono<{ Bindings: Env }>().route('/mcp', mcp);
    const result = await app.fetch(new Request('https://example.com/mcp/test-pending'), {} as Env);
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
