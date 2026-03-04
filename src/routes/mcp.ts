// MCP endpoint routes: token issuance + Streamable HTTP transport
import { Hono, Context } from 'hono';
import type { Env, McpClient } from '../types';
import { verifyPassword } from '../lib/crypto';
import { createMcpServer } from '../mcp/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { checkRateLimit, incrementRateLimit, clearRateLimit } from '../lib/rate-limit';

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
    let grantType: string | undefined;
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let code: string | undefined;
    let codeVerifier: string | undefined;

    if (contentType.includes('application/json')) {
        const body = await c.req.json();
        grantType = body.grant_type;
        clientId = body.client_id;
        clientSecret = body.client_secret;
        code = body.code;
        codeVerifier = body.code_verifier;
    } else {
        const form = await c.req.formData();
        grantType = form.get('grant_type')?.toString();
        clientId = form.get('client_id')?.toString();
        clientSecret = form.get('client_secret')?.toString();
        code = form.get('code')?.toString();
        codeVerifier = form.get('code_verifier')?.toString();
    }

    // Default to client_credentials if not provided (for backwards compatibility)
    grantType = grantType || 'client_credentials';

    if (!clientId) {
        return c.json({ error: 'client_id is required' }, 400);
    }

    // Rate limiting key
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const rlKey = `rate_limit:mcp:${ip}:${clientId}`;

    if (!(await checkRateLimit(c.env.RATE_LIMITER, rlKey))) {
        return c.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
    }

    // Look up client
    const client = await c.env.DB.prepare('SELECT * FROM mcp_clients WHERE client_id = ? AND is_active = 1')
        .bind(clientId)
        .first<McpClient>();

    if (!client) {
        await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
        return c.json({ error: 'invalid_client' }, 401);
    }

    // If client_credentials requires a secret, or if the client has a secret and we are doing code grant, verify it
    if (clientSecret) {
        const valid = await verifyPassword(clientSecret, client.secret_hash, client.salt);
        if (!valid) {
            await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
            return c.json({ error: 'invalid_client' }, 401);
        }
    } else if (grantType === 'client_credentials') {
        // Client credentials grant STRICTLY requires a secret
        await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
        return c.json({ error: 'invalid_client' }, 401);
    }

    if (grantType === 'authorization_code') {
        if (!code) {
            return c.json({ error: 'code is required for authorization_code grant' }, 400);
        }

        // Verify code
        const authCode = await c.env.DB.prepare(
            "SELECT * FROM oauth_auth_codes WHERE id = ? AND client_id = ? AND expires_at > datetime('now')"
        )
            .bind(code, clientId)
            .first<{ code_challenge: string | null }>();

        if (!authCode) {
            await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
            return c.json({ error: 'invalid_grant' }, 400);
        }

        // Verify PKCE if present
        if (authCode.code_challenge) {
            if (!codeVerifier) {
                return c.json({ error: 'code_verifier required' }, 400);
            }

            const encoder = new TextEncoder();
            const data = encoder.encode(codeVerifier);
            const digest = await crypto.subtle.digest('SHA-256', data);

            // Base64URL encode the digest
            const base64Digest = btoa(String.fromCharCode(...new Uint8Array(digest)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');

            if (base64Digest !== authCode.code_challenge) {
                return c.json({ error: 'invalid_grant' }, 400);
            }
        }

        // Consume the code
        await c.env.DB.prepare('DELETE FROM oauth_auth_codes WHERE id = ?').bind(code).run();
    } else if (grantType !== 'client_credentials') {
        return c.json({ error: 'unsupported_grant_type' }, 400);
    }

    await clearRateLimit(c.env.RATE_LIMITER, rlKey);

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

const handleMcpConnection = async (c: Context<{ Bindings: Env }>) => {
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

    // Phase 3: Synchronously check if the client was revoked *after* the token was issued
    const clientStatus = await c.env.DB.prepare('SELECT is_active FROM mcp_clients WHERE client_id = ?')
        .bind(clientId)
        .first<{ is_active: number }>();

    if (!clientStatus || clientStatus.is_active !== 1) {
        return c.json({ error: 'Client revoked or not found' }, 401);
    }

    // Create a fresh MCP server for this request
    const server = createMcpServer(c.env, clientId, clientName);

    // Use Web Standard Streamable HTTP transport natively supported in Cloudflare Workers
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless mode
    });

    await server.connect(transport);

    // Hand off the Web Standard Request to the transport
    return await transport.handleRequest(c.req.raw as Request);
};

mcp.post('/', handleMcpConnection);
mcp.post('/sse', handleMcpConnection);
mcp.get('/sse', handleMcpConnection);

// ── Health check ────────────────────────────────────────
mcp.get('/', async (c) => {
    // Restrict verbosity for unauthenticated users (finding #11)
    const authHeader = c.req.header('Authorization');
    let isAuthenticated = false;
    if (authHeader?.startsWith('Bearer ')) {
        const payload = await verifyJwt(authHeader.substring(7), c.env.JWT_SECRET!);
        if (payload) isAuthenticated = true;
    }

    if (!isAuthenticated) {
        return c.json({ status: 'ok' });
    }

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
