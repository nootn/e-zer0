/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env, AdminUser } from '../types';
import { Layout, Alert } from '../views/layout';
import { verifyPassword } from '../lib/crypto';
import { createSession } from '../lib/session';

const login = new Hono<{ Bindings: Env }>();

login.get('/', async (c) => {
    const error = c.req.query('error');
    return c.html(
        <Layout title="Login">
            {error && <Alert type="error">{decodeURIComponent(error)}</Alert>}
            <div class="card">
                <h2 style="font-size:18px; font-weight:600; margin-bottom:6px;">Welcome Back</h2>
                <p style="color:var(--text-muted); font-size:14px; margin-bottom:24px;">
                    Sign in to manage your e-zer0 instance.
                </p>
                <form method="post" action="/login">
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

    const user = await c.env.DB.prepare('SELECT * FROM admin_users WHERE username = ?')
        .bind(username)
        .first<AdminUser>();

    if (!user) {
        return c.redirect('/login?error=' + encodeURIComponent('Invalid username or password.'));
    }

    const valid = await verifyPassword(password, user.password_hash, user.salt);
    if (!valid) {
        return c.redirect('/login?error=' + encodeURIComponent('Invalid username or password.'));
    }

    const session = await createSession(c.env.DB, user.id);

    return new Response(null, {
        status: 302,
        headers: {
            Location: '/dashboard',
            'Set-Cookie': session.cookie,
        },
    });
});

export default login;
