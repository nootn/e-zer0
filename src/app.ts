import { Hono } from 'hono';
import type { Env } from './types';
import { authMiddleware } from './middleware/auth';
import { destroySession } from './lib/session';

// Route imports
import setupRoutes from './routes/setup';
import loginRoutes from './routes/login';
import dashboardRoutes from './routes/dashboard';
import accountRoutes from './routes/accounts';
import agentRoutes from './routes/agents';
import auditRoutes from './routes/audit';
import settingsRoutes from './routes/settings';
import oauthRoutes from './routes/oauth-callback';
import mcpRoutes from './routes/mcp';
import authorizeRoutes from './routes/authorize';
import registerRoutes from './routes/register';
import {
    SUPPORTED_CODE_CHALLENGE_METHODS,
    SUPPORTED_GRANT_TYPES,
    SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS,
} from './lib/mcp-oauth';

import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';

const app = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

// finding #8: Add Security Headers
app.use('*', secureHeaders());

// Startup guard: ensure critical bindings are present
app.use('*', async (c, next) => {
    if (!c.env.RATE_LIMITER) {
        console.error('FATAL MISCONFIGURATION: RATE_LIMITER KV namespace is not bound. Check wrangler.toml.');
        return c.text('Service misconfigured: missing RATE_LIMITER KV binding. Run `npm run setup-cf` to fix.', 503);
    }
    await next();
});

// finding #7: CSRF protection on mutation routes (UI only)
const csrfProtection = csrf();
app.use('/settings/*', csrfProtection);
app.use('/agents/*', csrfProtection);
app.use('/accounts/*', csrfProtection);
app.use('/setup/*', csrfProtection);
app.use('/login', csrfProtection);
app.use('/logout', csrfProtection);

// Global auth middleware
app.use('*', authMiddleware);

// Mount routes
app.route('/setup', setupRoutes);
app.route('/login', loginRoutes);
app.route('/dashboard', dashboardRoutes);
app.route('/accounts', accountRoutes);
app.route('/agents', agentRoutes);
app.route('/audit', auditRoutes);
app.route('/settings', settingsRoutes);
app.route('/oauth', oauthRoutes);
app.route('/mcp', mcpRoutes);
app.route('/authorize', authorizeRoutes);
app.route('/register', registerRoutes);

// OAuth Metadata endpoints (RFC 8414 / RFC 10064)
app.get('/.well-known/oauth-authorization-server', (c) => {
    const baseUrl = new URL(c.req.url).origin;
    return c.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/mcp/token`,
        registration_endpoint: `${baseUrl}/register`,
        response_types_supported: ['code'],
        grant_types_supported: [...SUPPORTED_GRANT_TYPES],
        token_endpoint_auth_methods_supported: [...SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS],
        code_challenge_methods_supported: [...SUPPORTED_CODE_CHALLENGE_METHODS],
        logo_uri: `${baseUrl}/logo.svg`,
    });
});

app.get('/.well-known/oauth-protected-resource', (c) => {
    const baseUrl = new URL(c.req.url).origin;
    return c.json({
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
    });
});

app.get('/.well-known/oauth-protected-resource/mcp/sse', (c) => {
    const baseUrl = new URL(c.req.url).origin;
    // Legacy SSE path — redirect discovery to the current Streamable HTTP endpoint
    return c.json({
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl],
    });
});

// Root redirect
app.get('/', (c) => c.redirect('/dashboard'));

// Global error handler — logs to Cloudflare Workers Logs (visible in dashboard)
app.onError((err, c) => {
    if (err instanceof HTTPException) {
        // 4xx are expected client errors (CSRF, auth, validation) — don't pollute error logs
        if (err.status >= 500) {
            console.error(`[${c.req.method}] ${new URL(c.req.url).pathname} — HTTP ${err.status}: ${err.message}`);
        }
        return err.getResponse();
    }
    // Unexpected errors — always log with stack trace
    console.error(`[${c.req.method}] ${new URL(c.req.url).pathname} — ${err.message}`, err.stack);
    return c.text('Internal Server Error', 500);
});

// Logout
app.post('/logout', async (c) => {
    const clearCookie = await destroySession(c.env.DB, c.req.header('Cookie'));
    return new Response(null, {
        status: 302,
        headers: {
            Location: '/login',
            'Set-Cookie': clearCookie,
        },
    });
});

// Robots.txt — prevent search indexing of this self-hosted app
app.get('/robots.txt', (c) => {
    return c.text('User-agent: *\nDisallow: /\n', 200, { 'Content-Type': 'text/plain' });
});

// Favicon — handled via <link rel="icon"> in layout; suppress 404 log noise
app.get('/favicon.ico', (c) => {
    return new Response(null, { status: 204 });
});

// Logo endpoint for OAuth metadata and MCP connectors
app.get('/logo.svg', (c) => {
    return c.text(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⚡</text></svg>`,
        200,
        {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=86400',
        }
    );
});

export default app;
