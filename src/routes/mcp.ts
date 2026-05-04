// MCP endpoint routes: token issuance + Streamable HTTP transport
import { Hono, Context } from 'hono';
import type { Env, McpClient } from '../types';
import { verifyPassword } from '../lib/crypto';
import { createMcpServer } from '../mcp/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { checkRateLimit, incrementRateLimit, clearRateLimit } from '../lib/rate-limit';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '../lib/mcp-oauth';

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
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const encoder = new TextEncoder();
        const data = `${parts[0]}.${parts[1]}`;

        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

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
    } catch {
        return null;
    }
}

// ── Token Endpoint (OAuth Client Credentials) ───────────

mcp.post('/token', async (c) => {
    const contentType = c.req.header('Content-Type') || '';
    let grantType: string | undefined;
    let clientId: string | undefined;
    let clientSecret: string | undefined;
    let code: string | undefined;
    let codeVerifier: string | undefined;
    let redirectUri: string | undefined;
    let refreshTokenBody: string | undefined;

    if (contentType.includes('application/json')) {
        const body = await c.req.json();
        grantType = body.grant_type;
        clientId = body.client_id;
        clientSecret = body.client_secret;
        code = body.code;
        codeVerifier = body.code_verifier;
        redirectUri = body.redirect_uri;
        refreshTokenBody = body.refresh_token;
    } else {
        const form = await c.req.formData();
        grantType = form.get('grant_type')?.toString();
        clientId = form.get('client_id')?.toString();
        clientSecret = form.get('client_secret')?.toString();
        code = form.get('code')?.toString();
        codeVerifier = form.get('code_verifier')?.toString();
        redirectUri = form.get('redirect_uri')?.toString();
        refreshTokenBody = form.get('refresh_token')?.toString();
    }

    grantType = grantType || 'client_credentials';
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';

    // 1. Pre-validation for refresh_token
    if (grantType === 'refresh_token') {
        const refreshPrecheckKey = `rate_limit:mcp:${ip}:refresh_precheck`;
        if (!(await checkRateLimit(c.env.RATE_LIMITER, refreshPrecheckKey))) {
            return c.json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
        }

        if (!refreshTokenBody) {
            await incrementRateLimit(c.env.RATE_LIMITER, refreshPrecheckKey);
            return c.json({ error: 'refresh_token is required' }, 400);
        }

        const payload = await verifyJwt(refreshTokenBody, c.env.JWT_SECRET!);
        if (!payload || payload.type !== 'refresh') {
            await incrementRateLimit(c.env.RATE_LIMITER, refreshPrecheckKey);
            return c.json({ error: 'invalid_grant' }, 400);
        }

        const now = Math.floor(Date.now() / 1000);
        if (typeof payload.exp !== 'number' || payload.exp <= now) {
            await incrementRateLimit(c.env.RATE_LIMITER, refreshPrecheckKey);
            return c.json({ error: 'invalid_grant' }, 400);
        }

        if (!clientId) clientId = payload.sub;
        if (clientId !== payload.sub) {
            await incrementRateLimit(c.env.RATE_LIMITER, refreshPrecheckKey);
            return c.json({ error: 'invalid_grant' }, 400);
        }
    }

    if (!clientId) {
        return c.json({ error: 'client_id is required' }, 400);
    }

    // Rate limiting key
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

    // Validate secret if provided, or if client_credentials requires it
    if (clientSecret) {
        const valid = await verifyPassword(clientSecret, client.secret_hash, client.salt);
        if (!valid) {
            await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
            return c.json({ error: 'invalid_client' }, 401);
        }
    } else if (grantType === 'client_credentials') {
        await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
        return c.json({ error: 'invalid_client' }, 401);
    }

    // 2. Grant validations
    if (grantType === 'authorization_code') {
        if (!code) return c.json({ error: 'code is required for authorization_code grant' }, 400);
        if (!redirectUri) return c.json({ error: 'redirect_uri is required for authorization_code grant' }, 400);

        const authCode = await c.env.DB.prepare(
            "SELECT * FROM oauth_auth_codes WHERE id = ? AND client_id = ? AND expires_at > datetime('now')"
        )
            .bind(code, clientId)
            .first<{ code_challenge: string | null; redirect_uri: string }>();

        if (!authCode) {
            await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
            return c.json({ error: 'invalid_grant' }, 400);
        }

        if (authCode.redirect_uri !== redirectUri) {
            await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
            return c.json({ error: 'invalid_grant' }, 400);
        }

        if (authCode.code_challenge) {
            if (!codeVerifier) return c.json({ error: 'code_verifier required' }, 400);
            const encoder = new TextEncoder();
            const digest = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
            const base64Digest = btoa(String.fromCharCode(...new Uint8Array(digest)))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');

            if (base64Digest !== authCode.code_challenge) return c.json({ error: 'invalid_grant' }, 400);
        }
        await c.env.DB.prepare('DELETE FROM oauth_auth_codes WHERE id = ?').bind(code).run();
    } else if (grantType !== 'client_credentials' && grantType !== 'refresh_token') {
        return c.json({ error: 'unsupported_grant_type' }, 400);
    }

    await clearRateLimit(c.env.RATE_LIMITER, rlKey);

    await c.env.DB.prepare('UPDATE mcp_clients SET last_used_at = datetime(?) WHERE id = ?')
        .bind(new Date().toISOString(), client.id)
        .run();

    const token = await signJwt(
        {
            sub: client.client_id,
            name: client.name,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS,
        },
        c.env.JWT_SECRET!
    );

    const result: any = { access_token: token, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS };

    if (grantType === 'authorization_code' || grantType === 'refresh_token') {
        result.refresh_token = await signJwt(
            {
                sub: client.client_id,
                name: client.name,
                type: 'refresh',
                iat: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL_SECONDS,
            },
            c.env.JWT_SECRET!
        );
    }

    return c.json(result);
});

// ── MCP Streamable HTTP Endpoint ────────────────────────

const handleMcpConnection = async (c: Context<{ Bindings: Env }>) => {
    // Verify JWT
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const payload = await verifyJwt(authHeader.substring(7), c.env.JWT_SECRET!);
    if (!payload || payload.type === 'refresh') {
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

    try {
        const reqClone = c.req.raw.clone();
        if (reqClone.method === 'POST') {
            const bodyText = await reqClone.text();
            if (bodyText) {
                const body = JSON.parse(bodyText);
                const rpcId = body.id || (Array.isArray(body) ? body.map((b: any) => b.id).join(',') : 'unknown');
                const rpcMethod =
                    body.method || (Array.isArray(body) ? body.map((b: any) => b.method).join(',') : 'unknown');

                const cfRay = c.req.header('cf-ray') || 'unknown';
                const traceparent = c.req.header('traceparent') || 'unknown';

                console.log(
                    JSON.stringify({
                        level: 'info',
                        message: `MCP Request: ${rpcMethod}`,
                        client_id: clientId,
                        client_name: clientName,
                        mcp_request_id: rpcId,
                        mcp_method: rpcMethod,
                        cf_ray: cfRay,
                        traceparent: traceparent,
                    })
                );
            }
        }
    } catch (e) {
        console.warn('Failed to parse MCP request body for logging', e);
    }

    // Hand off the Web Standard Request to the transport
    return await transport.handleRequest(c.req.raw as Request);
};

mcp.post('/', handleMcpConnection);
mcp.post('/sse', handleMcpConnection);
mcp.get('/sse', (c) => {
    // Legacy SSE transport is not supported. This server uses Streamable HTTP (POST /mcp).
    // Returning 405 immediately prevents the Worker from hanging on long-lived SSE GET requests.
    return c.json(
        {
            error: 'SSE transport not supported. Use Streamable HTTP: POST /mcp with MCP-Protocol-Version: 2025-03-26 or later.',
        },
        405,
        { Allow: 'POST' }
    );
});

// ── Health check ────────────────────────────────────────
mcp.get('/', async (c) => {
    // Restrict verbosity for unauthenticated users (finding #11)
    const authHeader = c.req.header('Authorization');
    let isAuthenticated = false;
    if (authHeader?.startsWith('Bearer ')) {
        const payload = await verifyJwt(authHeader.substring(7), c.env.JWT_SECRET!);
        if (payload && payload.type !== 'refresh') isAuthenticated = true;
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
