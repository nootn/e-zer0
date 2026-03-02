// Auto-generated encryption and JWT keys
// Stored in D1 app_settings (plaintext — they ARE the keys, can't encrypt themselves)
// Optionally overridden by wrangler secrets / env vars

import type { Env } from '../types';

/**
 * Get the encryption key. Priority:
 * 1. Worker secret (env var) if set
 * 2. D1 app_settings (auto-generated during first-run setup)
 *
 * Returns null if neither is available (pre-setup state).
 */
export async function getEncryptionKey(env: Env): Promise<string | null> {
    // Check env var first (allows override via wrangler secret)
    if (env.ENCRYPTION_KEY) return env.ENCRYPTION_KEY;

    // Check D1
    const row = await env.DB.prepare('SELECT encrypted_value FROM app_settings WHERE key = ?')
        .bind('_ENCRYPTION_KEY')
        .first<{ encrypted_value: string }>();

    return row?.encrypted_value ?? null;
}

/**
 * Get the JWT secret. Same priority as encryption key.
 */
export async function getJwtSecret(env: Env): Promise<string | null> {
    if (env.JWT_SECRET) return env.JWT_SECRET;

    const row = await env.DB.prepare('SELECT encrypted_value FROM app_settings WHERE key = ?')
        .bind('_JWT_SECRET')
        .first<{ encrypted_value: string }>();

    return row?.encrypted_value ?? null;
}

/**
 * Generate and store keys during first-run setup.
 * Called once when the admin account is created.
 */
export async function generateAndStoreKeys(db: D1Database): Promise<{ encryptionKey: string; jwtSecret: string }> {
    // Generate 64-char hex strings (32 bytes)
    const encryptionKeyBuf = new Uint8Array(32);
    const jwtSecretBuf = new Uint8Array(32);
    crypto.getRandomValues(encryptionKeyBuf);
    crypto.getRandomValues(jwtSecretBuf);

    const encryptionKey = Array.from(encryptionKeyBuf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const jwtSecret = Array.from(jwtSecretBuf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    // Store as plaintext (these are the encryption keys — can't encrypt themselves)
    // Prefixed with _ to distinguish from user-managed settings
    await db.batch([
        db
            .prepare(
                `INSERT INTO app_settings (key, encrypted_value, updated_at)
             VALUES ('_ENCRYPTION_KEY', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET encrypted_value = ?, updated_at = datetime('now')`
            )
            .bind(encryptionKey, encryptionKey),
        db
            .prepare(
                `INSERT INTO app_settings (key, encrypted_value, updated_at)
             VALUES ('_JWT_SECRET', ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET encrypted_value = ?, updated_at = datetime('now')`
            )
            .bind(jwtSecret, jwtSecret),
    ]);

    return { encryptionKey, jwtSecret };
}
