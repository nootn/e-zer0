// Log transport outcomes, never tokens, URLs, queries, response bodies or email content.
export function retryAfterSeconds(headers: Headers): number | undefined {
    const value = headers.get('Retry-After');
    const delay = value && /^\d+$/.test(value) ? Number(value) : value ? (Date.parse(value) - Date.now()) / 1000 : NaN;
    return Number.isFinite(delay) && delay >= 0 ? Math.ceil(delay) : undefined;
}

export async function providerRequest(provider: string, url: string, init?: RequestInit): Promise<Response> {
    const started = Date.now();
    const requestId = crypto.randomUUID();
    try {
        const response = await fetch(url, init);
        console.log(
            JSON.stringify({
                event: 'provider_response_headers',
                provider,
                provider_request_id: requestId,
                status: response.status,
                duration_ms: Date.now() - started,
            })
        );
        return response;
    } catch (error) {
        const name = error instanceof Error ? error.name : 'Error';
        console.log(
            JSON.stringify({
                event: 'provider_request_failed',
                provider,
                provider_request_id: requestId,
                error_name: name,
                error_kind:
                    name === 'AbortError'
                        ? 'aborted_source_unknown'
                        : name === 'TimeoutError'
                          ? 'timeout'
                          : 'network_failure',
                duration_ms: Date.now() - started,
            })
        );
        throw error;
    }
}
