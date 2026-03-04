import { execSync } from 'child_process';
import fs from 'fs';
import crypto from 'crypto';

// This script handles two tasks:
// 1. LOCAL: Generate ENCRYPTION_KEY + JWT_SECRET into .dev.vars (always runs)
// 2. REMOTE: Provision Cloudflare resources (D1, Vectorize, KV, Turnstile) — only when authenticated
//
// Usage:
//   npm run setup-cf              # Generates local keys; skips remote if unauthenticated
//   npm run setup-cf              # In GitHub Actions with CLOUDFLARE_API_TOKEN → full provisioning

const instanceName = process.env.INSTANCE_NAME || 'e-zer0';

// 1. Sanitize and validate INSTANCE_NAME to prevent command injection
if (!/^[a-zA-Z0-9-]+$/.test(instanceName)) {
    console.error('Error: INSTANCE_NAME must contain only alphanumeric characters and hyphens.');
    process.exit(1);
}

// ── Step 1: Generate local development keys (always runs) ───────────────
console.log('Checking for local development keys in .dev.vars...');
let devVars = '';
if (fs.existsSync('.dev.vars')) {
    devVars = fs.readFileSync('.dev.vars', 'utf8');
}

let encryptionKey = '';
let jwtSecret = '';

const encMatch = devVars.match(/^ENCRYPTION_KEY=(.+)$/m);
if (encMatch) encryptionKey = encMatch[1].trim();
else encryptionKey = crypto.randomBytes(32).toString('hex');

const jwtMatch = devVars.match(/^JWT_SECRET=(.+)$/m);
if (jwtMatch) jwtSecret = jwtMatch[1].trim();
else jwtSecret = crypto.randomBytes(32).toString('hex');

if (!encMatch || !jwtMatch) {
    console.log('Generating new keys and saving to .dev.vars...');
    const newDevVars = `ENCRYPTION_KEY=${encryptionKey}\nJWT_SECRET=${jwtSecret}\n`;
    fs.writeFileSync('.dev.vars', newDevVars);
    console.log('✅ .dev.vars created with ENCRYPTION_KEY and JWT_SECRET');
} else {
    console.log('✅ .dev.vars already has both keys — no changes needed.');
}

// ── Step 2: Check if we can reach Cloudflare (optional for local dev) ───
let isAuthenticated = false;
try {
    execSync('npx wrangler whoami', { stdio: 'ignore' });
    isAuthenticated = true;
} catch (e) {
    // Not authenticated — that's fine for local dev
}

if (!isAuthenticated) {
    console.log('');
    console.log('ℹ️  Not authenticated to Cloudflare — skipping remote resource provisioning.');
    console.log('   This is normal for local development. Your .dev.vars keys are ready.');
    console.log('   Run `npm run db:migrate:local` next, then `npm run dev`.');
    console.log('');
    console.log('   To provision remote resources (for deployment), authenticate first:');
    console.log('     npx wrangler login');
    console.log('     npm run setup-cf');
    console.log('');
    console.log('Setup complete (local only)!');
    process.exit(0);
}

// ── Step 3: Provision remote Cloudflare resources ───────────────────────
try {
    console.log('');
    console.log('Authenticated to Cloudflare — provisioning remote resources...');

    console.log(`Checking/Creating D1 Database: ${instanceName}-db...`);
    let dbId = '';
    try {
        const info = execSync(`npx wrangler d1 info ${instanceName}-db --json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        dbId = JSON.parse(info).uuid;
    } catch (e) {
        const create = execSync(`npx wrangler d1 create ${instanceName}-db`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const match = create.match(/database_id = "([^"]+)"/);
        if (match) dbId = match[1];
    }

    console.log(`Checking/Creating Vectorize Index: ${instanceName}-index...`);
    try {
        execSync(`npx wrangler vectorize get ${instanceName}-index`, { stdio: 'ignore' });
    } catch (e) {
        execSync(`npx wrangler vectorize create ${instanceName}-index --dimensions=384 --metric=cosine`, { stdio: 'inherit' });
    }

    console.log(`Checking/Creating KV Namespace: RATE_LIMITER...`);
    let kvId = '';
    try {
        const kvInfo = execSync(`npx wrangler kv namespace create RATE_LIMITER --binding RATE_LIMITER`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const match = kvInfo.match(/id = "([^"]+)"/);
        if (match) kvId = match[1];
    } catch (e) {
        const list = execSync(`npx wrangler kv namespace list`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const namespaces = JSON.parse(list);
        const ns = namespaces.find(n => n.title.includes('RATE_LIMITER'));
        if (ns) {
            kvId = ns.id;
        }
    }

    if (!kvId) {
        console.error('FATAL: Could not create or find RATE_LIMITER KV namespace. Rate limiting requires this binding.');
        process.exit(1);
    }

    const toml = `
name = "${instanceName}"
main = "src/index.ts"
compatibility_date = "2026-03-01"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[[d1_databases]]
binding = "DB"
database_name = "${instanceName}-db"
database_id = "${dbId}"

[[vectorize]]
binding = "VECTOR_INDEX"
index_name = "${instanceName}-index"

[[kv_namespaces]]
binding = "RATE_LIMITER"
id = "${kvId}"
`;

    fs.writeFileSync('wrangler.toml', toml.trim());
    console.log('✅ wrangler.toml generated with remote resource IDs.');

    // Push encryption/JWT secrets to Cloudflare
    try {
        console.log('Checking for existing secrets in Cloudflare...');

        let existingSecrets = [];
        try {
            const listOutput = execSync('npx wrangler secret list --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            existingSecrets = JSON.parse(listOutput).map(s => s.name);
        } catch (e) {
            // If json parsing fails or command fails, assume no secrets exist
            console.log('⚠️  Could not list existing secrets (you may not be authenticated). Proceeding to push...');
        }

        if (existingSecrets.includes('ENCRYPTION_KEY')) {
            console.log('✅ ENCRYPTION_KEY already exists in Cloudflare. Skipping.');
        } else {
            console.log('Pushing ENCRYPTION_KEY to Cloudflare...');
            execSync(`npx wrangler secret put ENCRYPTION_KEY`, { input: encryptionKey, stdio: ['pipe', 'ignore', 'ignore'] });
            console.log('✅ ENCRYPTION_KEY pushed.');
        }

        if (existingSecrets.includes('JWT_SECRET')) {
            console.log('✅ JWT_SECRET already exists in Cloudflare. Skipping.');
        } else {
            console.log('Pushing JWT_SECRET to Cloudflare...');
            execSync(`npx wrangler secret put JWT_SECRET`, { input: jwtSecret, stdio: ['pipe', 'ignore', 'ignore'] });
            console.log('✅ JWT_SECRET pushed.');
        }

    } catch (e) {
        console.log('⚠️  Could not push secrets to Cloudflare (non-fatal).');
    }

    // ── Turnstile (bot protection) ────────────────────────────────────────
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (accountId) {
        console.log(`Checking/Creating Turnstile site: ${instanceName}...`);
        try {
            const cfHeaders = {
                Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json',
            };

            // List existing widgets to find one matching this instance
            const listRes = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets`,
                { headers: cfHeaders }
            );
            const listData = await listRes.json();
            const existing = (listData.result ?? []).find((w) => w.name === instanceName);

            let sitekey, secret;
            if (existing) {
                // Secret is included in the individual GET response
                const getRes = await fetch(
                    `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets/${existing.sitekey}`,
                    { headers: cfHeaders }
                );
                const getData = await getRes.json();
                sitekey = getData.result?.sitekey;
                secret = getData.result?.secret;
                console.log('   Found existing Turnstile site.');
            } else {
                const createRes = await fetch(
                    `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets`,
                    {
                        method: 'POST',
                        headers: cfHeaders,
                        body: JSON.stringify({
                            name: instanceName,
                            domains: [],
                            mode: 'managed',
                            bot_fight_mode: false,
                            offlabel: false,
                            region: 'world',
                        }),
                    }
                );
                const createData = await createRes.json();
                sitekey = createData.result?.sitekey;
                secret = createData.result?.secret;
                console.log('   Created new Turnstile site.');
            }

            if (sitekey && secret) {
                execSync(`npx wrangler secret put TURNSTILE_SITE_KEY`, { input: sitekey, stdio: ['pipe', 'ignore', 'ignore'] });
                execSync(`npx wrangler secret put TURNSTILE_SECRET_KEY`, { input: secret, stdio: ['pipe', 'ignore', 'ignore'] });
                console.log('✅ Turnstile site key and secret key pushed to Cloudflare.');
            } else {
                console.log('⚠️  Could not retrieve Turnstile keys — check that your API token has Account | Turnstile | Edit permission.');
            }
        } catch (e) {
            console.log('⚠️  Turnstile setup failed (non-fatal):', e.message);
        }
    } else {
        console.log('ℹ️  CLOUDFLARE_ACCOUNT_ID not set — skipping Turnstile provisioning.');
    }

    console.log('');
    console.log('Setup complete (local + remote)!');
} catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
}