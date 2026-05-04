import { Hono } from 'hono';
import type { Env } from '../types';
import { generateClientId, generateClientSecret, generateSalt, hashPassword } from '../lib/crypto';
import { normalizeDynamicClientRegistration } from '../lib/mcp-oauth';
import { checkRateLimit, incrementRateLimit } from '../lib/rate-limit';

const register = new Hono<{ Bindings: Env }>();
const REGISTER_BURST_LIMIT = 5;
const REGISTER_DAILY_LIMIT = 25;

register.post('/', async (c) => {
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const burstKey = `rate_limit:register:burst:${ip}`;
    const dailyKey = `rate_limit:register:daily:${ip}`;

    if (!(await checkRateLimit(c.env.RATE_LIMITER, burstKey, REGISTER_BURST_LIMIT))) {
        return c.json(
            { error: 'too_many_requests', error_description: 'Too many registration attempts. Try again later.' },
            429
        );
    }

    if (!(await checkRateLimit(c.env.RATE_LIMITER, dailyKey, REGISTER_DAILY_LIMIT))) {
        return c.json(
            {
                error: 'too_many_requests',
                error_description: 'Daily registration limit reached for this IP. Try again tomorrow.',
            },
            429
        );
    }

    await incrementRateLimit(c.env.RATE_LIMITER, burstKey);
    await incrementRateLimit(c.env.RATE_LIMITER, dailyKey, 24 * 60 * 60);

    let body: unknown;

    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'invalid_client_metadata', error_description: 'Expected a JSON request body.' }, 400);
    }

    try {
        const registration = normalizeDynamicClientRegistration(body as Record<string, unknown>);
        const clientId = generateClientId();
        let clientSecret: string | undefined;
        let secretHash = '';
        let salt = '';

        if (registration.tokenEndpointAuthMethod === 'client_secret_post') {
            clientSecret = generateClientSecret();
            salt = generateSalt();
            secretHash = await hashPassword(clientSecret, salt);
        }

        await c.env.DB.prepare(
            `INSERT INTO mcp_clients (
                name,
                client_id,
                secret_hash,
                salt,
                redirect_uris,
                grant_types,
                token_endpoint_auth_method
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
            .bind(
                registration.clientName,
                clientId,
                secretHash,
                salt,
                JSON.stringify(registration.redirectUris),
                JSON.stringify(registration.grantTypes),
                registration.tokenEndpointAuthMethod
            )
            .run();

        const now = Math.floor(Date.now() / 1000);

        return c.json(
            {
                client_id: clientId,
                client_id_issued_at: now,
                client_name: registration.clientName,
                client_secret: clientSecret,
                client_secret_expires_at: clientSecret ? 0 : undefined,
                grant_types: registration.grantTypes,
                redirect_uris: registration.redirectUris,
                response_types: registration.responseTypes,
                token_endpoint_auth_method: registration.tokenEndpointAuthMethod,
            },
            201
        );
    } catch (error: any) {
        return c.json(
            {
                error: 'invalid_client_metadata',
                error_description: error?.message || 'Client metadata validation failed.',
            },
            400
        );
    }
});

export default register;
