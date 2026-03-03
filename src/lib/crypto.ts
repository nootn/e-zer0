// Crypto utilities using Web Crypto API (available in Cloudflare Workers)

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const AES_KEY_LENGTH = 256;
const IV_LENGTH = 12;

// ── Password Hashing (PBKDF2) ──────────────────────────

function bufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBuffer(hex: string): ArrayBuffer {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes.buffer;
}

export function generateSalt(): string {
    const salt = new Uint8Array(SALT_LENGTH);
    crypto.getRandomValues(salt);
    return bufferToHex(salt.buffer);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: new Uint8Array(hexToBuffer(salt)),
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        256
    );

    return bufferToHex(derivedBits);
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
    const candidateHash = await hashPassword(password, salt);
    // Constant-time comparison
    if (candidateHash.length !== hash.length) return false;
    let result = 0;
    for (let i = 0; i < candidateHash.length; i++) {
        result |= candidateHash.charCodeAt(i) ^ hash.charCodeAt(i);
    }
    return result === 0;
}

// ── AES-GCM Encryption ─────────────────────────────────

async function getAesKey(keyHex: string): Promise<CryptoKey> {
    const keyBytes = new Uint8Array(hexToBuffer(keyHex.substring(0, 64))); // Use first 32 bytes
    return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(plaintext: string, keyHex: string): Promise<string> {
    const key = await getAesKey(keyHex);
    const iv = new Uint8Array(IV_LENGTH);
    crypto.getRandomValues(iv);

    const encoder = new TextEncoder();
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext));

    // Concatenate IV + ciphertext and encode as hex
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return bufferToHex(combined.buffer);
}

export async function decrypt(cipherHex: string, keyHex: string): Promise<string> {
    const key = await getAesKey(keyHex);
    const data = new Uint8Array(hexToBuffer(cipherHex));

    const iv = data.slice(0, IV_LENGTH);
    const ciphertext = data.slice(IV_LENGTH);

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

    return new TextDecoder().decode(decrypted);
}

// ── Token Generation ────────────────────────────────────

export function generateToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bufferToHex(bytes.buffer);
}

export function generateClientId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return 'ez_' + bufferToHex(bytes.buffer);
}

export function generateClientSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return 'ezs_' + bufferToHex(bytes.buffer);
}
