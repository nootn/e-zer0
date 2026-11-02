import { retryAfterSeconds } from '../provider-request';

export class OAuthRefreshError extends Error {
    constructor(
        readonly provider: 'google' | 'microsoft',
        readonly httpStatus: number,
        readonly code?: string,
        readonly retryAfterSeconds?: number
    ) {
        super(`${provider} token refresh failed (HTTP ${httpStatus})${code ? `: ${code}` : ''}.`);
        this.name = 'OAuthRefreshError';
    }
}

export async function oauthRefreshError(provider: 'google' | 'microsoft', response: Response) {
    let code: string | undefined;
    try {
        const body = (await response.json()) as { error?: unknown };
        if (
            typeof body.error === 'string' &&
            [
                'invalid_grant',
                'invalid_client',
                'invalid_scope',
                'temporarily_unavailable',
                'server_error',
                'unauthorized_client',
                'access_denied',
            ].includes(body.error)
        )
            code = body.error;
    } catch {
        /* Preserve safe HTTP metadata even when the error body is absent. */
    }
    return new OAuthRefreshError(provider, response.status, code, retryAfterSeconds(response.headers));
}
