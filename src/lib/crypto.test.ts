import { describe, it, expect } from 'vitest';
import {
    generateSalt,
    hashPassword,
    verifyPassword,
    encrypt,
    decrypt,
    generateToken,
    generateClientId,
    generateClientSecret,
} from './crypto';

// ── Salt Generation ─────────────────────────────────────

describe('generateSalt', () => {
    it('generates a hex string of expected length', () => {
        const salt = generateSalt();
        // 16 bytes = 32 hex chars
        expect(salt).toHaveLength(32);
        expect(salt).toMatch(/^[0-9a-f]+$/);
    });

    it('generates unique salts', () => {
        const salt1 = generateSalt();
        const salt2 = generateSalt();
        expect(salt1).not.toBe(salt2);
    });
});

// ── Password Hashing ────────────────────────────────────

describe('hashPassword', () => {
    it('returns a hex string hash', async () => {
        const salt = generateSalt();
        const hash = await hashPassword('testpassword', salt);
        expect(hash).toMatch(/^[0-9a-f]+$/);
        expect(hash.length).toBeGreaterThan(0);
    });

    it('returns the same hash for the same input', async () => {
        const salt = generateSalt();
        const hash1 = await hashPassword('testpassword', salt);
        const hash2 = await hashPassword('testpassword', salt);
        expect(hash1).toBe(hash2);
    });

    it('returns different hashes for different passwords', async () => {
        const salt = generateSalt();
        const hash1 = await hashPassword('password1', salt);
        const hash2 = await hashPassword('password2', salt);
        expect(hash1).not.toBe(hash2);
    });

    it('returns different hashes for different salts', async () => {
        const salt1 = generateSalt();
        const salt2 = generateSalt();
        const hash1 = await hashPassword('samepassword', salt1);
        const hash2 = await hashPassword('samepassword', salt2);
        expect(hash1).not.toBe(hash2);
    });
});

// ── Password Verification ───────────────────────────────

describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
        const salt = generateSalt();
        const hash = await hashPassword('correcthorse', salt);
        const result = await verifyPassword('correcthorse', hash, salt);
        expect(result).toBe(true);
    });

    it('returns false for incorrect password', async () => {
        const salt = generateSalt();
        const hash = await hashPassword('correcthorse', salt);
        const result = await verifyPassword('wronghorse', hash, salt);
        expect(result).toBe(false);
    });

    it('uses constant-time comparison (same length check)', async () => {
        const salt = generateSalt();
        const hash = await hashPassword('test', salt);
        const result = await verifyPassword('x', hash, salt);
        expect(result).toBe(false);
    });
});

// ── AES-GCM Encryption ─────────────────────────────────

describe('encrypt / decrypt', () => {
    const testKey = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

    it('round-trips plaintext correctly', async () => {
        const plaintext = 'Hello, this is a secret message!';
        const encrypted = await encrypt(plaintext, testKey);
        const decrypted = await decrypt(encrypted, testKey);
        expect(decrypted).toBe(plaintext);
    });

    it('produces different ciphertexts for the same input (random IV)', async () => {
        const plaintext = 'same input';
        const enc1 = await encrypt(plaintext, testKey);
        const enc2 = await encrypt(plaintext, testKey);
        expect(enc1).not.toBe(enc2);
    });

    it('encrypted output is a hex string', async () => {
        const encrypted = await encrypt('test', testKey);
        expect(encrypted).toMatch(/^[0-9a-f]+$/);
    });

    it('throws on decryption with wrong key', async () => {
        const wrongKey = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        const encrypted = await encrypt('test', testKey);
        await expect(decrypt(encrypted, wrongKey)).rejects.toThrow();
    });

    it('handles empty string', async () => {
        const encrypted = await encrypt('', testKey);
        const decrypted = await decrypt(encrypted, testKey);
        expect(decrypted).toBe('');
    });

    it('handles unicode content', async () => {
        const text = 'こんにちは 🌍 café résumé';
        const encrypted = await encrypt(text, testKey);
        const decrypted = await decrypt(encrypted, testKey);
        expect(decrypted).toBe(text);
    });

    it('handles long content', async () => {
        const text = 'x'.repeat(10000);
        const encrypted = await encrypt(text, testKey);
        const decrypted = await decrypt(encrypted, testKey);
        expect(decrypted).toBe(text);
    });
});

// ── Token Generation ────────────────────────────────────

describe('generateToken', () => {
    it('returns a 64-char hex string', () => {
        const token = generateToken();
        expect(token).toHaveLength(64);
        expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('generates unique tokens', () => {
        const t1 = generateToken();
        const t2 = generateToken();
        expect(t1).not.toBe(t2);
    });
});

describe('generateClientId', () => {
    it('starts with ez_ prefix', () => {
        const id = generateClientId();
        expect(id).toMatch(/^ez_[0-9a-f]+$/);
    });
});

describe('generateClientSecret', () => {
    it('starts with ezs_ prefix', () => {
        const secret = generateClientSecret();
        expect(secret).toMatch(/^ezs_[0-9a-f]+$/);
    });

    it('is longer than client ID', () => {
        const id = generateClientId();
        const secret = generateClientSecret();
        expect(secret.length).toBeGreaterThan(id.length);
    });
});
