import { z } from 'zod';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const MAX_DYNAMIC_CLIENT_NAME_LENGTH = 200;

export const SUPPORTED_GRANT_TYPES = ['authorization_code', 'client_credentials', 'refresh_token'] as const;
export const SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS = ['none', 'client_secret_post'] as const;
export const SUPPORTED_CODE_CHALLENGE_METHODS = ['S256'] as const;

export type SupportedTokenEndpointAuthMethod = (typeof SUPPORTED_TOKEN_ENDPOINT_AUTH_METHODS)[number];

const dynamicClientRegistrationRequestSchema = z
    .object({
        client_name: z.string().optional(),
        grant_types: z.array(z.string()).optional(),
        redirect_uris: z.array(z.string()).optional(),
        response_types: z.array(z.string()).optional(),
        token_endpoint_auth_method: z.string().optional(),
    })
    .passthrough();

export type DynamicClientRegistrationRequest = z.infer<typeof dynamicClientRegistrationRequestSchema>;

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
        // RFC 6749 §3.1.2 also forbids fragments in redirect URIs.
        return (
            (url.protocol === 'https:' || isLocalhostHttp) &&
            url.username === '' &&
            url.password === '' &&
            url.hash === ''
        );
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

export function parseDynamicClientRegistrationRequest(payload: unknown): DynamicClientRegistrationRequest {
    const parsed = dynamicClientRegistrationRequestSchema.safeParse(payload);
    if (parsed.success) {
        return parsed.data;
    }

    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join('.') : 'request body';
    throw new Error(`${path} has an invalid type`);
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

    if (clientName.length > MAX_DYNAMIC_CLIENT_NAME_LENGTH) {
        throw new Error(`client_name must be ${MAX_DYNAMIC_CLIENT_NAME_LENGTH} characters or fewer`);
    }

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
