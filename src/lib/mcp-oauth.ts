export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export const SUPPORTED_GRANT_TYPES = ['authorization_code', 'client_credentials', 'refresh_token'] as const;
export const SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS = ['none', 'client_secret_post'] as const;
export const SUPPORTED_CODE_CHALLENGE_METHODS = ['S256'] as const;

export type SupportedTokenEndpointAuthMethod = (typeof SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS)[number];

export interface DynamicClientRegistrationRequest {
    client_name?: string;
    grant_types?: string[];
    redirect_uris?: string[];
    response_types?: string[];
    token_endpoint_auth_method?: string;
}

export interface NormalizedDynamicClientRegistration {
    clientName: string;
    grantTypes: string[];
    redirectUris: string[];
    responseTypes: string[];
    tokenEndpointAuthMethod: SupportedTokenEndpointAuthMethod;
}

export function parseStoredJsonArray(value: string | null | undefined): string[] {
    if (!value) return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string') ? parsed : [];
    } catch {
        return [];
    }
}

export function isValidRedirectUri(redirectUri: string): boolean {
    try {
        const url = new URL(redirectUri);
        const isLocalhostHttp =
            url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname.toLowerCase());

        // RFC 8252 forbids userinfo in redirect URIs, even for native app callbacks.
        return (url.protocol === 'https:' || isLocalhostHttp) && url.username === '' && url.password === '';
    } catch {
        return false;
    }
}

export function isAllowedRedirectUri(registeredRedirectUris: string[], requestedRedirectUri: string): boolean {
    if (!isValidRedirectUri(requestedRedirectUri)) {
        return false;
    }

    return registeredRedirectUris.includes(requestedRedirectUri);
}

export function requiresPkce(tokenEndpointAuthMethod: string | null | undefined): boolean {
    return tokenEndpointAuthMethod === 'none';
}

export function requiresClientSecret(tokenEndpointAuthMethod: string | null | undefined): boolean {
    return (tokenEndpointAuthMethod ?? 'client_secret_post') === 'client_secret_post';
}

export function normalizeDynamicClientRegistration(
    payload: DynamicClientRegistrationRequest
): NormalizedDynamicClientRegistration {
    const clientName = payload.client_name?.trim() || 'Dynamic MCP Client';
    const redirectUris = Array.from(new Set(payload.redirect_uris ?? []));
    const grantTypes = Array.from(
        new Set(payload.grant_types?.length ? payload.grant_types : ['authorization_code', 'refresh_token'])
    );
    const responseTypes = Array.from(new Set(payload.response_types?.length ? payload.response_types : ['code']));
    const tokenEndpointAuthMethod = (payload.token_endpoint_auth_method ??
        'client_secret_post') as SupportedTokenEndpointAuthMethod;

    if (redirectUris.length === 0) {
        throw new Error('redirect_uris must contain at least one redirect URI');
    }

    if (!redirectUris.every((uri) => isValidRedirectUri(uri))) {
        throw new Error('redirect_uris must only contain https:// or localhost callback URLs');
    }

    if (
        !grantTypes.every((grantType) =>
            SUPPORTED_GRANT_TYPES.includes(grantType as (typeof SUPPORTED_GRANT_TYPES)[number])
        )
    ) {
        throw new Error(`grant_types must only contain supported values: ${SUPPORTED_GRANT_TYPES.join(', ')}`);
    }

    if (!grantTypes.includes('authorization_code')) {
        throw new Error('grant_types must include authorization_code');
    }

    if (!responseTypes.every((responseType) => responseType === 'code')) {
        throw new Error('response_types must only contain "code"');
    }

    if (!SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS.includes(tokenEndpointAuthMethod)) {
        throw new Error(
            `token_endpoint_auth_method must be one of: ${SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS.join(', ')}`
        );
    }

    if (tokenEndpointAuthMethod === 'none' && grantTypes.includes('client_credentials')) {
        throw new Error('Public clients using token_endpoint_auth_method=none cannot use client_credentials');
    }

    return {
        clientName,
        grantTypes,
        redirectUris,
        responseTypes,
        tokenEndpointAuthMethod,
    };
}
