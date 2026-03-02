// Email content sanitizer: PII redaction + prompt injection detection
// Zero dependencies — runs on Cloudflare Workers edge runtime

// ── PII Redaction Patterns ──────────────────────────────

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
    // Credit card numbers (Visa, Mastercard, Amex, Discover, etc.)
    {
        name: 'credit_card',
        pattern:
            /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|6(?:011|5[0-9]{2})[0-9]{12}|(?:2131|1800|35\d{3})\d{11})\b/g,
        replacement: '[CREDIT_CARD_REDACTED]',
    },
    // Credit card with dashes/spaces
    {
        name: 'credit_card_formatted',
        pattern: /\b(?:\d{4}[-\s]){3}\d{4}\b/g,
        replacement: '[CREDIT_CARD_REDACTED]',
    },
    // CVV/CVC (3-4 digits following common labels)
    {
        name: 'cvv',
        pattern: /(?:CVV|CVC|CVV2|CVC2|security\s*code)\s*:?\s*\d{3,4}/gi,
        replacement: '[CVV_REDACTED]',
    },
    // National Identity Numbers (US SSN, UK NINO)
    {
        name: 'national_id',
        pattern: /\b(?:\d{3}[-\s]?\d{2}[-\s]?\d{4}|[A-Z]{2}[-\s]?\d{2}[-\s]?\d{2}[-\s]?\d{2}[-\s]?[A-Z])\b/gi,
        replacement: '[NATIONAL_ID_REDACTED]',
    },
    // Tax ID Numbers (Australian TFN, Canadian SIN - 9 digits)
    {
        name: 'tax_id',
        pattern: /\b\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/g,
        replacement: '[TAX_ID_REDACTED]',
    },
    // Passwords / PINs (when labeled)
    {
        name: 'password',
        pattern:
            /(?:password|passwd|pwd|pin|passcode|secret\s*key|api[_\s]*key|access[_\s]*token|auth[_\s]*token)\s*[:=]\s*\S+/gi,
        replacement: '[PASSWORD_REDACTED]',
    },
    // Temporary passwords / OTPs in common email formats
    {
        name: 'temp_password',
        pattern:
            /(?:temporary\s+password|one[- ]time\s+(?:password|code|pin)|OTP|verification\s+code|reset\s+code|confirmation\s+code)\s*[:=]?\s*[A-Za-z0-9!@#$%^&*]{4,20}/gi,
        replacement: '[TEMP_CODE_REDACTED]',
    },
    // Bank account / routing numbers (when labeled)
    {
        name: 'bank_account',
        pattern: /(?:account\s*(?:number|#|no)|routing\s*(?:number|#|no)|IBAN|SWIFT)\s*[:=]?\s*[A-Z0-9]{6,34}/gi,
        replacement: '[BANK_ACCOUNT_REDACTED]',
    },
    // AWS / API keys (common patterns)
    {
        name: 'api_key',
        pattern: /(?:AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9\-]{20,})/g,
        replacement: '[API_KEY_REDACTED]',
    },
    // Private keys
    {
        name: 'private_key',
        pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
        replacement: '[PRIVATE_KEY_REDACTED]',
    },
];

// ── Prompt Injection Detection ──────────────────────────

const INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp; severity: 'high' | 'medium' | 'low' }> = [
    // Direct instruction overrides
    {
        name: 'system_override',
        pattern: /\b(?:ignore\s+(?:all\s+)?(?:previous|above|prior)\s+(?:instructions?|prompts?|rules?|context))/gi,
        severity: 'high',
    },
    {
        name: 'new_instructions',
        pattern: /\b(?:new\s+instructions?|forget\s+(?:everything|all|your)\s+(?:instructions?|prompts?|rules?))/gi,
        severity: 'high',
    },
    {
        name: 'you_are_now',
        pattern:
            /\b(?:you\s+are\s+now|act\s+as\s+(?:if\s+you\s+are|a)|pretend\s+(?:to\s+be|you\s+are)|from\s+now\s+on\s+you)/gi,
        severity: 'high',
    },

    // Role manipulation
    {
        name: 'role_play',
        pattern: /\b(?:system\s*:\s*|assistant\s*:\s*|user\s*:\s*|\[SYSTEM\]|\[INST\]|\[\/INST\])/gi,
        severity: 'high',
    },
    {
        name: 'role_switch',
        pattern: /\b(?:switch\s+(?:to|into)\s+(?:system|admin|developer|root)\s+mode)/gi,
        severity: 'high',
    },

    // Delimiter injection
    {
        name: 'delimiter',
        pattern: /(?:<\|(?:im_start|im_end|system|endoftext)\|>|<<SYS>>|<\/SYS>|<\/?s>|\[INST\])/gi,
        severity: 'high',
    },

    // Data exfiltration
    {
        name: 'exfil_url',
        pattern:
            /\b(?:send|post|fetch|navigate|open|visit|load)\s+(?:to|this|the|data|results?)\s+(?:to\s+)?(?:https?:\/\/|(?:my|this)\s+(?:server|url|endpoint))/gi,
        severity: 'high',
    },
    {
        name: 'exfil_encode',
        pattern: /\b(?:encode|base64|hex|url[_\s]?encode)\s+(?:and\s+)?(?:send|include|append|embed)/gi,
        severity: 'medium',
    },

    // System prompt extraction
    {
        name: 'reveal_prompt',
        pattern:
            /\b(?:show|reveal|display|print|output|repeat|recite)\s+(?:me\s+)?(?:your|the|system)\s+(?:system\s+)?(?:prompt|instructions?|rules?|configuration)/gi,
        severity: 'high',
    },

    // Encoded injection attempts (base64 markers)
    {
        name: 'encoded_payload',
        pattern: /(?:eval|execute|run)\s*\(\s*(?:atob|btoa|decode|unescape)/gi,
        severity: 'high',
    },

    // Multi-line separator attacks
    {
        name: 'separator_attack',
        pattern: /(?:-{5,}|={5,}|\*{5,}|#{5,})\s*(?:ignore|new|system|instructions?|begin)/gi,
        severity: 'medium',
    },

    // Markdown/HTML injection to manipulate rendering
    {
        name: 'markdown_injection',
        pattern: /!\[.*?\]\(https?:\/\/[^)]*\?\s*(?:callback|exfil|data)=/gi,
        severity: 'medium',
    },
];

// ── Public API ──────────────────────────────────────────

export interface SanitizeResult {
    sanitizedText: string;
    redactions: Array<{ type: string; count: number }>;
    injectionWarnings: Array<{ type: string; severity: string; match: string }>;
    riskScore: number; // 0-100, higher = more suspicious
}

/**
 * Sanitize email content by redacting PII and detecting prompt injection attempts.
 * Returns cleaned text safe for MCP responses.
 */
export function sanitizeEmailContent(text: string): SanitizeResult {
    let sanitizedText = text;
    const redactions: Array<{ type: string; count: number }> = [];
    const injectionWarnings: Array<{ type: string; severity: string; match: string }> = [];
    let riskScore = 0;

    // ── Step 1: Redact PII ──────────────────────────────
    for (const { name, pattern, replacement } of PII_PATTERNS) {
        // Reset lastIndex for global regexes
        pattern.lastIndex = 0;
        const matches = sanitizedText.match(pattern);
        if (matches && matches.length > 0) {
            redactions.push({ type: name, count: matches.length });
            sanitizedText = sanitizedText.replace(pattern, replacement);
        }
    }

    // ── Step 2: Detect Prompt Injection ─────────────────
    for (const { name, pattern, severity } of INJECTION_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = sanitizedText.match(pattern);
        if (matches) {
            for (const match of matches) {
                injectionWarnings.push({
                    type: name,
                    severity,
                    match: match.substring(0, 50), // Truncate for logging
                });
                riskScore += severity === 'high' ? 30 : severity === 'medium' ? 15 : 5;
            }
        }
    }

    // Cap risk score at 100
    riskScore = Math.min(riskScore, 100);

    // ── Step 3: If high risk, wrap content with warning ─
    if (riskScore >= 50) {
        sanitizedText = `⚠️ [e-zer0 SAFETY WARNING: This email content scored ${riskScore}/100 on prompt injection risk. Content has been sanitized but exercise caution.]\n\n${sanitizedText}`;
    }

    return { sanitizedText, redactions, injectionWarnings, riskScore };
}

/**
 * Quick check if text contains potential prompt injection.
 * Returns true if suspicious patterns detected.
 */
export function hasPotentialInjection(text: string): boolean {
    for (const { pattern } of INJECTION_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(text)) return true;
    }
    return false;
}
