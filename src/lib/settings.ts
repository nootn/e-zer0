// Encrypted app settings stored in D1
import { encrypt, decrypt } from './crypto';

/**
 * Get a decrypted setting value from D1.
 * Returns null if the setting doesn't exist.
 */
export async function getSetting(db: D1Database, key: string, encryptionKey: string): Promise<string | null> {
    const row = await db
        .prepare('SELECT encrypted_value FROM app_settings WHERE key = ?')
        .bind(key)
        .first<{ encrypted_value: string }>();

    if (!row) return null;

    try {
        return await decrypt(row.encrypted_value, encryptionKey);
    } catch {
        return null;
    }
}

/**
 * Set an encrypted setting value in D1.
 * If the value is empty, deletes the setting.
 */
export async function setSetting(db: D1Database, key: string, value: string, encryptionKey: string): Promise<void> {
    if (!value || value.trim() === '') {
        await db.prepare('DELETE FROM app_settings WHERE key = ?').bind(key).run();
        return;
    }

    const encryptedValue = await encrypt(value, encryptionKey);
    await db
        .prepare(
            `INSERT INTO app_settings (key, encrypted_value, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET encrypted_value = ?, updated_at = datetime('now')`
        )
        .bind(key, encryptedValue, encryptedValue)
        .run();
}

/**
 * Check if a setting exists (without decrypting).
 */
export async function hasSetting(db: D1Database, key: string): Promise<boolean> {
    const row = await db.prepare('SELECT 1 FROM app_settings WHERE key = ?').bind(key).first();
    return !!row;
}

// ── OAuth Credential Helpers ────────────────────────────

/**
 * Get OAuth credentials from D1 settings only (no env var fallback).
 */
export async function getOAuthCredentials(
    db: D1Database,
    provider: 'google' | 'microsoft',
    encryptionKey: string
): Promise<{ clientId: string; clientSecret: string } | null> {
    const prefix = provider === 'google' ? 'GOOGLE' : 'MICROSOFT';

    const clientId = await getSetting(db, `${prefix}_CLIENT_ID`, encryptionKey);
    const clientSecret = await getSetting(db, `${prefix}_CLIENT_SECRET`, encryptionKey);

    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret };
}
