/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env, AdminUser } from '../types';
import { Layout, Alert } from '../views/layout';
import { generateSalt, hashPassword } from '../lib/crypto';
import { createSession } from '../lib/session';

const setup = new Hono<{ Bindings: Env }>();

setup.get('/', async (c) => {
    return c.html(
        <Layout title="Initial Setup">
            {(!c.env.ENCRYPTION_KEY || !c.env.JWT_SECRET) && (
                <Alert type="error">
                    <strong>Critical Security Warning:</strong> Deployment missing root keys. Please ensure
                    ENCRYPTION_KEY and JWT_SECRET are set via Cloudflare Secrets or .dev.vars.
                </Alert>
            )}
            <div class="card">
                <h2 style="font-size:18px; font-weight:600; margin-bottom:6px;">Create Admin Account</h2>
                <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px;">
                    Set up your admin credentials to secure your e-zer0 instance.
                </p>
                <form method="post" action="/setup" id="setup-form">
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
                            placeholder="admin"
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
                            autocomplete="new-password"
                            minLength={8}
                            placeholder="Minimum 8 characters"
                        />
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="confirm">
                            Confirm Password
                        </label>
                        <input
                            class="form-input"
                            type="password"
                            id="confirm"
                            name="confirm"
                            required
                            autocomplete="new-password"
                            minLength={8}
                            placeholder="Re-enter password"
                        />
                    </div>
                    <button type="submit" class="btn btn-primary btn-full">
                        Create Admin Account
                    </button>
                </form>
            </div>
        </Layout>
    );
});

setup.post('/', async (c) => {
    const form = await c.req.formData();
    const username = form.get('username')?.toString().trim();
    const password = form.get('password')?.toString();
    const confirm = form.get('confirm')?.toString();

    // Validate
    if (!username || !password || !confirm) {
        return c.html(
            <Layout title="Initial Setup">
                <Alert type="error">All fields are required.</Alert>
                <div class="card">
                    <a href="/setup" class="btn btn-ghost btn-full">
                        Try Again
                    </a>
                </div>
            </Layout>,
            400
        );
    }

    if (username.length > 255) {
        return c.html(
            <Layout title="Initial Setup">
                <Alert type="error">Username cannot exceed 255 characters.</Alert>
                <div class="card">
                    <a href="/setup" class="btn btn-ghost btn-full">
                        Try Again
                    </a>
                </div>
            </Layout>,
            400
        );
    }

    if (password !== confirm) {
        return c.html(
            <Layout title="Initial Setup">
                <Alert type="error">Passwords do not match.</Alert>
                <div class="card">
                    <a href="/setup" class="btn btn-ghost btn-full">
                        Try Again
                    </a>
                </div>
            </Layout>,
            400
        );
    }

    if (password.length < 8) {
        return c.html(
            <Layout title="Initial Setup">
                <Alert type="error">Password must be at least 8 characters.</Alert>
                <div class="card">
                    <a href="/setup" class="btn btn-ghost btn-full">
                        Try Again
                    </a>
                </div>
            </Layout>,
            400
        );
    }

    // Check if admin already exists
    const existing = await c.env.DB.prepare('SELECT COUNT(*) as count FROM admin_users').first<{ count: number }>();
    if (existing && existing.count > 0) {
        return c.redirect('/login');
    }

    // Create admin
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    const result = await c.env.DB.prepare('INSERT INTO admin_users (username, password_hash, salt) VALUES (?, ?, ?)')
        .bind(username, hash, salt)
        .run();

    // Create session and redirect to dashboard
    const userId = result.meta.last_row_id as number;
    const session = await createSession(c.env.DB, userId);

    return new Response(null, {
        status: 302,
        headers: {
            Location: '/dashboard',
            'Set-Cookie': session.cookie,
        },
    });
});

export default setup;
