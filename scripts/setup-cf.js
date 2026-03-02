import { execSync } from 'child_process';
import fs from 'fs';

// This script runs in GitHub Actions to auto-provision Cloudflare resources
const instanceName = process.env.INSTANCE_NAME || 'e-zer0';

try {
    console.log(`Checking/Creating D1 Database: ${instanceName}-db...`);
    let dbId = '';
    try {
        const info = execSync(`npx wrangler d1 info ${instanceName}-db --json`, { encoding: 'utf8' });
        dbId = JSON.parse(info).uuid;
    } catch (e) {
        const create = execSync(`npx wrangler d1 create ${instanceName}-db`, { encoding: 'utf8' });
        const match = create.match(/database_id = "([^"]+)"/);
        if (match) dbId = match[1];
    }

    console.log(`Checking/Creating Vectorize Index: ${instanceName}-index...`);
    try {
        execSync(`npx wrangler vectorize get ${instanceName}-index`, { stdio: 'ignore' });
    } catch (e) {
        execSync(`npx wrangler vectorize create ${instanceName}-index --dimensions=384 --metric=cosine`, { stdio: 'inherit' });
    }

    const toml = `
name = "${instanceName}"
main = "src/index.ts"
compatibility_date = "2024-03-20"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "${instanceName}-db"
database_id = "${dbId}"

[[vectorize]]
binding = "VECTOR_INDEX"
index_name = "${instanceName}-index"
`;

    fs.writeFileSync('wrangler.toml', toml.trim());
    console.log('wrangler.toml generated successfully!');
} catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
}