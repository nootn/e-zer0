import type { Env, Session } from '../types';
import { generateToken } from './crypto';

const SESSION_COOKIE_NAME = 'ezer0_session';
const SESSION_DURATION_HOURS = 24;

export async function createSession(db: D1Database, userId: number): Promise<{ token: string; cookie: string }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();

    await db
        .prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)')
        .bind(userId, token, expiresAt)
        .run();

    const cookie = `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_HOURS * 3600}`;
    return { token, cookie };
}

export async function validateSession(
    db: D1Database,
    cookieHeader: string | undefined
): Promise<{ userId: number; username: string } | null> {
    if (!cookieHeader) return null;

    const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!token) return null;

    const row = await db
        .prepare(
            `SELECT s.user_id, s.expires_at, u.username
       FROM sessions s
       JOIN admin_users u ON u.id = s.user_id
       WHERE s.token = ?`
        )
        .bind(token)
        .first<{ user_id: number; expires_at: string; username: string }>();

    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
        // Clean up expired session
        await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        return null;
    }

    return { userId: row.user_id, username: row.username };
}

export async function destroySession(db: D1Database, cookieHeader: string | undefined): Promise<string> {
    if (cookieHeader) {
        const token = parseCookie(cookieHeader, SESSION_COOKIE_NAME);
        if (token) {
            await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
        }
    }
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function parseCookie(cookieHeader: string, name: string): string | null {
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? match[1] : null;
}
