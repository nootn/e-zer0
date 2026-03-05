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

    if (account.provider === 'google') {
        const result = await refreshGoogleToken(refreshToken, creds.clientId, creds.clientSecret);
        newAccessToken = result.access_token;
        expiresIn = result.expires_in;
    } else {
        const result = await refreshMicrosoftToken(refreshToken, creds.clientId, creds.clientSecret);
        newAccessToken = result.access_token;
        expiresIn = result.expires_in;
        newRefreshToken = result.refresh_token;
    }

    const encryptedAccess = await encrypt(newAccessToken, encryptionKey);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    if (newRefreshToken) {
        const encryptedRefresh = await encrypt(newRefreshToken, encryptionKey);
        await env.DB.prepare(
            `UPDATE email_accounts
             SET encrypted_access_token = ?, encrypted_refresh_token = ?, token_expires_at = ?, status = 'active', updated_at = datetime('now')
             WHERE id = ?`
        )
            .bind(encryptedAccess, encryptedRefresh, expiresAt, account.id)
            .run();
    } else {
        await env.DB.prepare(
            `UPDATE email_accounts
             SET encrypted_access_token = ?, token_expires_at = ?, status = 'active', updated_at = datetime('now')
             WHERE id = ?`
        )
            .bind(encryptedAccess, expiresAt, account.id)
            .run();
    }
}
