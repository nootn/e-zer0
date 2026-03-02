// MCP endpoint routes: token issuance + Streamable HTTP transport
import { Hono } from 'hono';
import type { Env, McpClient } from '../types';
import { verifyPassword } from '../lib/crypto';
import { createMcpServer } from '../mcp/server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const mcp = new Hono<{ Bindings: Env }>();

// ── Simple JWT Implementation ───────────────────────────
// Using a compact HMAC-SHA256 signed token (no external JWT library needed)

async function signJwt(payload: Record<string, any>, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
    const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
    const data = `${header}.${body}`;

    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
    ]);

    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

    return `${data}.${sigStr}`;
}

async function verifyJwt(token: string, secret: string): Promise<Record<string, any> | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const data = `${parts[0]}.${parts[1]}`;

    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'verify',
    ]);

    // Reconstruct signature
    const sigStr = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const sigPadded = sigStr + '='.repeat((4 - (sigStr.length % 4)) % 4);
    const sigBytes = Uint8Array.from(atob(sigPadded), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
    if (!valid) return null;

    const bodyPadded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(atob(bodyPadded));

    // Check expiry
    if (payload.exp && payload.exp < Date.now() / 1000) return null;

    return payload;
}

// ── Token Endpoint (OAuth Client Credentials) ───────────

mcp.post('/token', async (c) => {
    const contentType = c.req.header('Content-Type') || '';
    let clientId: string | undefined;
    let clientSecret: string | undefined;

    if (contentType.includes('application/json')) {
        const body = await c.req.json();
        clientId = body.client_id;
        clientSecret = body.client_secret;
    } else {
        const form = await c.req.formData();
        clientId = form.get('client_id')?.toString();
        clientSecret = form.get('client_secret')?.toString();
    }

    if (!clientId || !clientSecret) {
        return c.json({ error: 'client_id and client_secret are required' }, 400);
    }

    // Look up client
    const client = await c.env.DB.prepare('SELECT * FROM mcp_clients WHERE client_id = ? AND is_active = 1')
        .bind(clientId)
        .first<McpClient>();

    if (!client) {
        return c.json({ error: 'invalid_client' }, 401);
    }

    // Verify secret
    const valid = await verifyPassword(clientSecret, client.secret_hash, client.salt);
    if (!valid) {
        return c.json({ error: 'invalid_client' }, 401);
    }

    // Update last_used_at
    await c.env.DB.prepare('UPDATE mcp_clients SET last_used_at = datetime(?) WHERE id = ?')
        .bind(new Date().toISOString(), client.id)
        .run();

    // Issue JWT (1 hour expiry)
    const token = await signJwt(
        {
            sub: client.client_id,
            name: client.name,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
        },
        c.env.JWT_SECRET!
    );

    return c.json({
        access_token: token,
        token_type: 'Bearer',
        expires_in: 3600,
    });
});

// ── MCP Streamable HTTP Endpoint ────────────────────────

mcp.post('/', async (c) => {
    // Verify JWT
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const payload = await verifyJwt(authHeader.substring(7), c.env.JWT_SECRET!);
    if (!payload) {
        return c.json({ error: 'Invalid or expired token' }, 401);
    }

    const clientId = payload.sub as string;
    const clientName = (payload.name as string) || null;

    // Create a fresh MCP server for this request
    const server = createMcpServer(c.env, clientId, clientName);

    // Use Streamable HTTP transport
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
    });

    await server.connect(transport);

    // Handle the request
    const body = await c.req.json();
    await transport.handleRequest(c.req.raw, body, c.res as any);

    // The transport writes the response directly via c.res.
    // If we reach here, return a fallback.
    return c.json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' } });
});

// ── Health check ────────────────────────────────────────
mcp.get('/', (c) => {
    return c.json({
        name: 'e-zer0 MCP Server',
        version: '1.0.0',
        transport: 'streamable-http',
        endpoints: {
            token: '/mcp/token',
            mcp: '/mcp/',
        },
    });
});

export default mcp;
