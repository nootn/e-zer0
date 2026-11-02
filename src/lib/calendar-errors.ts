import type { CalendarErrorDetails } from '../types';
import { retryAfterSeconds } from './provider-request';

export class CalendarAccessError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly httpStatus?: number,
        readonly provider?: 'google' | 'microsoft',
        readonly providerReason?: string,
        readonly retryAfterSeconds?: number
    ) {
        super(message);
        this.name = 'CalendarAccessError';
    }

    toJSON(): CalendarErrorDetails {
        return {
            code: this.code,
            message: this.message,
            http_status: this.httpStatus,
            provider: this.provider,
            provider_reason: this.providerReason,
            retry_after_seconds: this.retryAfterSeconds,
        };
    }
}

const safeReasons = new Set([
    'authError',
    'invalidCredentials',
    'InvalidAuthenticationToken',
    'ErrorInvalidAuthenticationToken',
    'insufficientPermissions',
    'insufficient_scope',
    'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    'ErrorAccessDenied',
    'forbidden',
    'notFound',
    'ErrorItemNotFound',
    'rateLimitExceeded',
    'userRateLimitExceeded',
    'quotaExceeded',
    'TooManyRequests',
]);
const scopeReasons = new Set(['insufficient_scope', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']);

export async function calendarProviderError(response: Response, provider: 'google' | 'microsoft') {
    let reason: string | undefined;
    try {
        const body = (await response.json()) as {
            error?: { code?: unknown; errors?: { reason?: unknown }[]; details?: { reason?: unknown }[] };
        };
        const reasons = [
            body.error?.code,
            ...(body.error?.errors || []).map((e) => e.reason),
            ...(body.error?.details || []).map((e) => e.reason),
        ];
        reason =
            reasons.find((value): value is string => typeof value === 'string' && scopeReasons.has(value)) ??
            reasons.find((value): value is string => typeof value === 'string' && safeReasons.has(value));
    } catch {
        /* Error responses may be empty or non-JSON. Never echo their contents. */
    }
    const status = response.status;
    if (status === 401)
        return new CalendarAccessError(
            'provider_token_invalid',
            'Calendar provider rejected the access token as invalid or expired; consent is not known to be missing.',
            status,
            provider,
            reason
        );
    if (status === 403 && scopeReasons.has(reason || ''))
        return new CalendarAccessError(
            'provider_scope_missing',
            'Calendar provider reports insufficient OAuth scopes. Ask the user to reconnect this account with calendar consent; existing email and calendar grants were not changed.',
            status,
            provider,
            reason
        );
    if (
        status === 429 ||
        ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'TooManyRequests'].includes(reason || '')
    ) {
        return new CalendarAccessError(
            'provider_rate_limited',
            'Calendar provider rate limit reached. Defer further reads; do not reconnect or change grants.',
            status,
            provider,
            reason,
            retryAfterSeconds(response.headers)
        );
    }
    if (status === 403)
        return new CalendarAccessError(
            'provider_calendar_forbidden',
            'Calendar provider denied this read. Check calendar sharing and provider policy; this is separate from the agent calendar grant.',
            status,
            provider,
            reason
        );
    if (status === 404)
        return new CalendarAccessError(
            'provider_calendar_unavailable',
            'Calendar was not found or is not readable through this provider account.',
            status,
            provider,
            reason
        );
    return new CalendarAccessError(
        'provider_calendar_failed',
        `Calendar provider request failed (HTTP ${status}).`,
        status,
        provider,
        reason
    );
}
