/**
 * Verifies a Cloudflare Turnstile challenge token server-side.
 * Returns true if the token is valid (or if Turnstile is not configured).
 */
export async function verifyTurnstile(secretKey: string, token: string, ip?: string): Promise<boolean> {
    const body = new URLSearchParams({ secret: secretKey, response: token });
    if (ip) body.set('remoteip', ip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body,
    });

    if (!res.ok) return false;
    const data = (await res.json()) as { success: boolean };
    return data.success === true;
}
