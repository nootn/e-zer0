// Encryption and JWT keys
// These must be provided via environment variables (e.g. .dev.vars locally or Cloudflare Secrets in production)

import type { Env } from '../types';

/**
 * Get the encryption key.
 * Must be provided via Worker secret (env var).
 */
export async function getEncryptionKey(env: Env): Promise<string | null> {
    return env.ENCRYPTION_KEY || null;
}

/**
 * Get the JWT secret.
 * Must be provided via Worker secret (env var).
 */
export async function getJwtSecret(env: Env): Promise<string | null> {
    return env.JWT_SECRET || null;
}
