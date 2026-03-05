// Cloudflare Worker entry point
import app from './app';
import type { Env, EmailAccount } from './types';
import { decrypt, encrypt } from './lib/crypto';
import { refreshGoogleToken } from './lib/oauth/google';
import { refreshMicrosoftToken } from './lib/oauth/microsoft';
import { getEncryptionKey } from './lib/keys';
import { getOAuthCredentials } from './lib/settings';
import { refreshAccountToken } from './lib/oauth/refresh';

export default {
    // ── HTTP Handler ──────────────────────────────────────
    fetch: app.fetch,

    // ── Scheduled Handler (Cron) ──────────────────────────
    // Runs hourly to refresh OAuth tokens before they expire
    async scheduled(_event, env: Env, _ctx) {
        console.log('Running scheduled token refresh...');

        // Resolve encryption key from D1 if not in env
        const encryptionKey = await getEncryptionKey(env);
        if (!encryptionKey) {
            console.error('No encryption key available — skipping token refresh.');
            return;
        }

        const accounts = await env.DB.prepare(
            `SELECT * FROM email_accounts
         WHERE status = 'active'
         AND encrypted_refresh_token IS NOT NULL
         AND token_expires_at IS NOT NULL
         AND datetime(token_expires_at) < datetime('now', '+30 minutes')`
        ).all<EmailAccount>();

        for (const account of accounts.results ?? []) {
            try {
                await refreshAccountToken(env, account);

                console.log(`Refreshed token for account ${account.id} (${account.email_address})`);
            } catch (err: any) {
                console.error(`Failed to refresh token for account ${account.id}:`, err.message);
                await env.DB.prepare(
                    `UPDATE email_accounts SET status = 'expired', updated_at = datetime('now') WHERE id = ?`
                )
                    .bind(account.id)
                    .run();
            }
        }
    },
} satisfies ExportedHandler<Env>;
