import { createMiddleware } from 'hono/factory';
import type { Env } from '../types';
import { validateSession } from '../lib/session';

// Paths that don't require authentication
const PUBLIC_PATHS = [
    '/setup',
    '/login',
    '/register',
    '/favicon.ico',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp/sse',
    '/logo.svg',
];
const MCP_PATHS = ['/mcp'];

export const authMiddleware = createMiddleware<{ Bindings: Env; Variables: { userId: number; username: string } }>(
    async (c, next) => {
        const path = new URL(c.req.url).pathname;

        // Allow MCP paths (they have their own JWT auth)
        if (MCP_PATHS.some((p) => path.startsWith(p))) {
            return next();
        }

        // Check if any admin user exists
        const adminCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM admin_users').first<{
            count: number;
        }>();

        const hasAdmin = adminCount && adminCount.count > 0;

        // No admin exists → force setup
        if (!hasAdmin) {
            if (path === '/setup') return next();
            return c.redirect('/setup');
        }

        // Admin exists but user is on /setup → block
        if (hasAdmin && path === '/setup') {
            return c.redirect('/login');
        }

        // Allow public paths
        if (PUBLIC_PATHS.some((p) => path === p)) {
            return next();
        }

        // Validate session
        const session = await validateSession(c.env.DB, c.req.header('Cookie'));
        if (!session) {
            const redirectUrl = encodeURIComponent(c.req.url);
            return c.redirect(`/login?redirect_to=${redirectUrl}`);
        }

        // Set user info on context
        c.set('userId', session.userId);
        c.set('username', session.username);
        return next();
    }
);
