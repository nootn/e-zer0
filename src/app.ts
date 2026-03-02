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

import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';

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

// Root redirect
app.get('/', (c) => c.redirect('/dashboard'));

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

// Favicon (prevent 404)
app.get('/favicon.ico', (c) => {
    return new Response(null, { status: 204 });
});

export default app;
