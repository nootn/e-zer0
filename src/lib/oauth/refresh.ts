import type { Env, EmailAccount } from '../../types';
import { decrypt, encrypt } from '../crypto';
import { refreshGoogleToken } from './google';
import { refreshMicrosoftToken } from './microsoft';
import { getEncryptionKey } from '../keys';
import { getOAuthCredentials } from '../settings';

export async function refreshAccountToken(env: Env, account: EmailAccount): Promise<void> {
    const encryptionKey = await getEncryptionKey(env);
    if (!encryptionKey) {
        throw new Error('No encryption key available.');
    }

    if (!account.encrypted_refresh_token) {
        throw new Error('No refresh token available for this account.');
    }

    const refreshToken = await decrypt(account.encrypted_refresh_token, encryptionKey);
    const creds = await getOAuthCredentials(env.DB, account.provider, encryptionKey);

    if (!creds) {
        throw new Error(`No OAuth credentials for ${account.provider}`);
    }

    let newAccessToken: string;
    let expiresIn: number;
    let newRefreshToken: string | undefined;
    let scopes: string | undefined;

    if (account.provider === 'google') {
        const result = await refreshGoogleToken(refreshToken, creds.clientId, creds.clientSecret);
        newAccessToken = result.access_token;
        expiresIn = result.expires_in;
        newRefreshToken = result.refresh_token;
        scopes = result.scope;
    } else {
        const result = await refreshMicrosoftToken(refreshToken, creds.clientId, creds.clientSecret);
        newAccessToken = result.access_token;
        expiresIn = result.expires_in;
        newRefreshToken = result.refresh_token;
        scopes = result.scope;
    }

    const encryptedAccess = await encrypt(newAccessToken, encryptionKey);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const encryptedRefresh = newRefreshToken ? await encrypt(newRefreshToken, encryptionKey) : null;
    await env.DB.prepare(
        `UPDATE email_accounts
         SET encrypted_access_token = ?, encrypted_refresh_token = COALESCE(?, encrypted_refresh_token),
             token_expires_at = ?, granted_scopes = COALESCE(?, granted_scopes), status = 'active', updated_at = datetime('now')
         WHERE id = ? AND status = ? AND encrypted_refresh_token IS ? AND encrypted_access_token IS ?`
    )
        .bind(
            encryptedAccess,
            encryptedRefresh,
            expiresAt,
            scopes ?? null,
            account.id,
            account.status,
            account.encrypted_refresh_token,
            account.encrypted_access_token
        )
        .run();
}
