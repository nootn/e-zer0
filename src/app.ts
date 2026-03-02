import { Hono } from 'hono';
import type { Env } from './types';
import { authMiddleware } from './middleware/auth';
import { destroySession } from './lib/session';
import { getEncryptionKey, getJwtSecret } from './lib/keys';

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

const app = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

// Resolve auto-generated keys from D1 (before auth middleware)
app.use('*', async (c, next) => {
    try {
        if (!c.env.ENCRYPTION_KEY) {
            const key = await getEncryptionKey(c.env);
            if (key) (c.env as any).ENCRYPTION_KEY = key;
        }
        if (!c.env.JWT_SECRET) {
            const secret = await getJwtSecret(c.env);
            if (secret) (c.env as any).JWT_SECRET = secret;
        }
    } catch {
        // Pre-setup state — tables may not exist yet
    }
    await next();
});

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
