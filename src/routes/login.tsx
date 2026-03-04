/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env, AdminUser } from '../types';
import { Layout, Alert } from '../views/layout';
import { verifyPassword } from '../lib/crypto';
import { createSession } from '../lib/session';
import { checkRateLimit, incrementRateLimit, clearRateLimit } from '../lib/rate-limit';
import { verifyTurnstile } from '../lib/turnstile';

const login = new Hono<{ Bindings: Env }>();

login.get('/', async (c) => {
    const error = c.req.query('error');
    const siteKey = c.env.TURNSTILE_SITE_KEY;
    return c.html(
        <Layout title="Login" turnstileSiteKey={siteKey}>
            {error && <Alert type="error">{decodeURIComponent(error)}</Alert>}
            <div class="card">
                <h2 style="font-size:18px; font-weight:600; margin-bottom:6px;">Welcome Back</h2>
                <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px;">
                    Sign in to manage your e-zer0 instance.
                </p>
                <form method="post" action="/login">
                    <input type="hidden" name="redirect_to" value={c.req.query('redirect_to') || ''} />
                    <div class="form-group">
                        <label class="form-label" for="username">
                            Username
                        </label>
                        <input
                            class="form-input"
                            type="text"
                            id="username"
                            name="username"
                            required
                            autocomplete="username"
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="password">
                            Password
                        </label>
                        <input
                            class="form-input"
                            type="password"
                            id="password"
                            name="password"
                            required
                            autocomplete="current-password"
                        />
                    </div>
                    {siteKey && (
                        <div class="form-group" style="display:flex; justify-content:center;">
                            <div class="cf-turnstile" data-sitekey={siteKey} data-theme="dark"></div>
                        </div>
                    )}
                    <button type="submit" class="btn btn-primary btn-full">
                        Sign In
                    </button>
                </form>
            </div>
        </Layout>
    );
});

login.post('/', async (c) => {
    const form = await c.req.formData();
    const username = form.get('username')?.toString().trim();
    const password = form.get('password')?.toString();

    if (!username || !password) {
        return c.redirect('/login?error=' + encodeURIComponent('All fields are required.'));
    }

    // Turnstile verification (skipped if not configured — local dev)
    if (c.env.TURNSTILE_SECRET_KEY) {
        const token = form.get('cf-turnstile-response')?.toString() ?? '';
        const ip = c.req.header('CF-Connecting-IP');
        const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, token, ip);
        if (!ok) {
            return c.redirect('/login?error=' + encodeURIComponent('Bot check failed. Please try again.'));
        }
    }

    if (username.length > 255) {
        return c.redirect('/login?error=' + encodeURIComponent('Username too long.'));
    }

    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const rlKey = `rate_limit:login:${ip}:${username}`;

    if (!(await checkRateLimit(c.env.RATE_LIMITER, rlKey))) {
        return c.redirect('/login?error=' + encodeURIComponent('Too many failed attempts. Try again in 15 minutes.'));
    }

    const user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE username = ?')
        .bind(username)
        .first<AdminUser>();

    if (!user) {
        await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
        return c.redirect('/login?error=' + encodeURIComponent('Invalid username or password.'));
    }

    const valid = await verifyPassword(password, user.password_hash, user.salt);
    if (!valid) {
        await incrementRateLimit(c.env.RATE_LIMITER, rlKey);
        return c.redirect('/login?error=' + encodeURIComponent('Invalid username or password.'));
    }

    await clearRateLimit(c.env.RATE_LIMITER, rlKey);

    // Rotate session (invalidate old ones) finding #12
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();

    // Background cleanup of expired sessions generically (finding #13)
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run().catch(console.error);

    const session = await createSession(c.env.DB, user.id);

    const redirectTo = form.get('redirect_to')?.toString();
    let targetLocation = '/dashboard';

    if (redirectTo) {
        try {
            const url = new URL(redirectTo);
            // Only allow same-origin redirects to prevent Open Redirect
            if (url.origin === new URL(c.req.url).origin) {
                targetLocation = url.pathname + url.search;
            }
        } catch (e) {
            // Invalid URL, fallback to dashboard
        }
    }

    return new Response(null, {
        status: 302,
        headers: {
            Location: targetLocation,
            'Set-Cookie': session.cookie,
        },
    });
});

export default login;
