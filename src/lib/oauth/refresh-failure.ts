import type { EmailAccount } from '../../types';

export async function markAccountRefreshFailed(
    db: D1Database,
    snapshot: Pick<EmailAccount, 'id' | 'status' | 'encrypted_refresh_token' | 'encrypted_access_token'>,
    status: 'expired' | 'error'
): Promise<void> {
    await db
        .prepare(
            `UPDATE email_accounts SET status = ?, updated_at = datetime('now')
         WHERE id = ? AND status = ?
           AND encrypted_refresh_token IS ? AND encrypted_access_token IS ?`
        )
        .bind(status, snapshot.id, snapshot.status, snapshot.encrypted_refresh_token, snapshot.encrypted_access_token)
        .run();
}
