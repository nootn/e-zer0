import type { Env, EmailAccount, CalendarAccessDiagnostics } from '../../types';
import { decrypt } from '../crypto';
import { CalendarAccessError } from '../calendar-errors';
import { refreshAccountToken } from './refresh';
import { OAuthRefreshError } from './refresh-errors';

// Coalesce refreshes in this isolate only; always re-read grants and account state afterwards.
const refreshing = new WeakMap<D1Database, Map<number, Promise<void>>>();

export async function withCalendarAccess<T extends object>(
    env: Env,
    clientId: string,
    accountId: number,
    read: (account: EmailAccount, token: string) => Promise<T>
) {
    async function loadAccount() {
        const permitted = await env.DB.prepare(
            `SELECT 1 FROM mcp_client_calendar_accounts ca JOIN mcp_clients mc ON mc.id = ca.mcp_client_id
             WHERE mc.client_id = ? AND mc.is_active = 1 AND ca.email_account_id = ?`
        )
            .bind(clientId, accountId)
            .first();
        if (!permitted)
            throw new CalendarAccessError(
                'calendar_grant_missing',
                'This agent has no calendar grant for the requested account. Email grants do not grant calendar access.'
            );
        const account = await env.DB.prepare('SELECT * FROM email_accounts WHERE id = ?')
            .bind(accountId)
            .first<EmailAccount>();
        if (!account || account.status !== 'active')
            throw new CalendarAccessError(
                'calendar_account_inactive',
                'The calendar provider account is inactive or unavailable. Its existing agent grants have not been changed.'
            );
        if (!account.encrypted_access_token)
            throw new CalendarAccessError(
                'calendar_credentials_missing',
                'No provider access token is stored for this calendar account. Ask the user to reconnect this account.'
            );
        return account;
    }
    let account = await loadAccount();
    let refreshed = false;
    async function useNewerCredentials() {
        const latest = await loadAccount();
        const expiry = latest.token_expires_at ? Date.parse(latest.token_expires_at) : NaN;
        const usable =
            latest.encrypted_access_token !== account.encrypted_access_token &&
            (!Number.isFinite(expiry) || expiry > Date.now());
        account = latest;
        return usable;
    }
    async function refresh() {
        refreshed = true;
        let pending = refreshing.get(env.DB);
        if (!pending) {
            pending = new Map();
            refreshing.set(env.DB, pending);
        }
        let operation = pending.get(accountId);
        if (!operation) {
            operation = (async () => {
                if (await useNewerCredentials()) return;
                await refreshAccountToken(env, account);
            })();
            pending.set(accountId, operation);
        }
        try {
            await operation;
        } catch (error) {
            if (error instanceof OAuthRefreshError && error.httpStatus === 429)
                throw new CalendarAccessError(
                    'provider_rate_limited',
                    'Provider token refresh is rate limited. Defer further calls and honour the retry delay; do not reconnect or change grants.',
                    error.httpStatus,
                    error.provider,
                    undefined,
                    error.retryAfterSeconds
                );
            if (await useNewerCredentials()) return;
            const invalidGrant = error instanceof OAuthRefreshError && error.code === 'invalid_grant';
            throw new CalendarAccessError(
                invalidGrant ? 'provider_reauthentication_required' : 'provider_refresh_failed',
                invalidGrant
                    ? 'The provider refresh grant is expired or revoked. Ask the user to reconnect this account; agent permissions and email access were not changed.'
                    : 'Could not refresh the existing provider token. Check provider connectivity and OAuth configuration; no agent permissions were changed.',
                error instanceof OAuthRefreshError ? error.httpStatus : undefined,
                account.provider,
                error instanceof OAuthRefreshError ? error.code : undefined,
                error instanceof OAuthRefreshError ? error.retryAfterSeconds : undefined
            );
        } finally {
            if (pending.get(accountId) === operation) pending.delete(accountId);
        }
        account = await loadAccount();
    }
    const expiresAt = account.token_expires_at ? Date.parse(account.token_expires_at) : NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now() + 60_000) await refresh();
    async function execute() {
        if (!env.ENCRYPTION_KEY)
            throw new CalendarAccessError(
                'calendar_credentials_missing',
                'Provider encryption configuration is unavailable.'
            );
        let token: string;
        try {
            token = await decrypt(account.encrypted_access_token!, env.ENCRYPTION_KEY);
        } catch {
            throw new CalendarAccessError(
                'calendar_credentials_invalid',
                'The stored provider token could not be decrypted. Ask the administrator to check encryption configuration before reconnecting.'
            );
        }
        return read(account, token);
    }
    let result: T;
    try {
        result = await execute();
    } catch (error) {
        if (!(error instanceof CalendarAccessError) || error.code !== 'provider_token_invalid' || refreshed)
            throw error;
        await refresh();
        result = await execute();
    }
    const access: CalendarAccessDiagnostics = {
        account_id: accountId,
        token_expires_at: account.token_expires_at ?? null,
        scopes_recorded: typeof account.granted_scopes === 'string',
        refreshed,
    };
    return { ...result, access };
}
