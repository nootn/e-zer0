import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { Hono } from 'hono';
import agents, { updateAgentNameAndAccounts } from '../routes/agents';
import authorize from '../routes/authorize';
import type { Env } from '../types';
import { permissionAuditStatement } from './permission-audit';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture() {
    const sqlite = new DatabaseSync(':memory:');
    databases.push(sqlite);
    const migrations = new URL('../../migrations/', import.meta.url);
    for (const file of readdirSync(migrations)
        .filter((file) => file.endsWith('.sql'))
        .sort()) {
        sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
    }
    sqlite.exec(`
        INSERT INTO admin_users (id, username, password_hash, salt) VALUES (7, 'admin', 'hash', 'salt');
        INSERT INTO email_accounts (id, provider, email_address, alias, status)
        VALUES (1, 'google', 'one@example.com', 'One', 'active'),
               (2, 'google', 'two@example.com', 'Two', 'active'),
               (3, 'google', 'private@example.com', 'Private', 'expired');
        INSERT INTO mcp_clients (id, name, client_id, secret_hash, salt, redirect_uris, grant_types, token_endpoint_auth_method)
        VALUES (11, 'Original private name', 'ez-public-client', 'secret-hash', 'salt',
                '["https://client.example/callback"]', '["authorization_code"]', 'none');
        INSERT INTO mcp_client_accounts (mcp_client_id, email_account_id) VALUES (11, 1);
        INSERT INTO mcp_client_calendar_accounts (mcp_client_id, email_account_id) VALUES (11, 2), (11, 3);
    `);
    function prepare(sql: string) {
        let values: (string | number | null)[] = [];
        return {
            bind(...params: (string | number | null)[]) {
                values = params;
                return this;
            },
            async first() {
                return sqlite.prepare(sql).get(...values) ?? null;
            },
            async all() {
                return { results: sqlite.prepare(sql).all(...values) };
            },
            async run() {
                sqlite.prepare(sql).run(...values);
                return { success: true };
            },
        };
    }
    let beforeBatch = () => {};
    const db = {
        prepare,
        async batch(statements: ReturnType<typeof prepare>[]) {
            beforeBatch();
            sqlite.exec('BEGIN');
            try {
                const results = [];
                for (const statement of statements) results.push(await statement.run());
                sqlite.exec('COMMIT');
                return results;
            } catch (error) {
                sqlite.exec('ROLLBACK');
                throw error;
            }
        },
    } as unknown as D1Database;
    const app = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();
    app.use('*', async (c, next) => {
        c.set('userId', 7);
        c.set('username', 'admin');
        await next();
    });
    app.route('/agents', agents);
    app.route('/authorize', authorize);
    const grants = () => ({
        email_account_ids: sqlite
            .prepare('SELECT email_account_id FROM mcp_client_accounts ORDER BY email_account_id')
            .all()
            .map((row) => row.email_account_id),
        calendar_account_ids: sqlite
            .prepare('SELECT email_account_id FROM mcp_client_calendar_accounts ORDER BY email_account_id')
            .all()
            .map((row) => row.email_account_id),
    });
    return {
        sqlite,
        grants,
        db,
        beforeBatch(fn: () => void) {
            beforeBatch = fn;
        },
        request(path: string, fields: Record<string, string>) {
            return app.request(path, { method: 'POST', body: new URLSearchParams(fields) }, { DB: db });
        },
    };
}

const paths = [
    {
        path: '/agents/11/accounts',
        action: 'agent_permissions_updated',
        fields: { name: 'New private name', permissions_form: 'combined' },
        email: [2],
        calendar: [1],
    },
    {
        path: '/agents/11/accounts',
        action: 'agent_permissions_updated',
        fields: { name: 'New private name' },
        email: [2],
        calendar: [2, 3],
    },
    {
        path: '/agents/11/calendars',
        action: 'agent_calendar_permissions_updated',
        fields: {},
        email: [1],
        calendar: [1],
    },
    {
        path: '/authorize',
        action: 'oauth_permissions_updated',
        fields: {
            name: 'New private name',
            client_id: 'ez-public-client',
            redirect_uri: 'https://client.example/callback',
            code_challenge: 'private-challenge',
            code_challenge_method: 'S256',
        },
        email: [2],
        calendar: [2, 3],
    },
];
const before = { email_account_ids: [1], calendar_account_ids: [2, 3] };

it.each(paths)(
    'audits safe before/after grants atomically for $path ($action)',
    async ({ path, action, fields, email, calendar }) => {
        const f = fixture();
        const response = await f.request(path, { ...fields, account_ids: '2', calendar_account_ids: '1' });
        expect(response.status).toBe(302);
        expect(f.grants()).toEqual({ email_account_ids: email, calendar_account_ids: calendar });
        const logs = f.sqlite.prepare('SELECT * FROM audit_logs').all();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            client_id: 'ez-public-client',
            client_name: null,
            target: 'agent:11',
            action,
            success: 1,
            error_message: null,
        });
        expect(JSON.parse(logs[0].details as string)).toEqual({
            agent_id: 11,
            admin_user_id: 7,
            before: { ...before, is_active: 1 },
            after: { ...f.grants(), is_active: 1 },
        });
        expect(
            f.sqlite.prepare('SELECT c.id FROM audit_logs a JOIN mcp_clients c ON c.client_id = a.client_id').all()
        ).toEqual([{ id: 11 }]);
        const serialized = JSON.stringify(logs);
        for (const secret of [
            'private',
            '@',
            'secret-hash',
            'salt',
            ...f.sqlite
                .prepare('SELECT id FROM oauth_auth_codes')
                .all()
                .map((row) => row.id as string),
        ]) {
            expect(serialized).not.toContain(secret);
        }
    }
);

it.each(paths)(
    'allows empty selections without clearing untouched capabilities for $path ($action)',
    async ({ path, fields }) => {
        const f = fixture();
        await f.request(path, fields);
        expect(f.grants()).toEqual({
            email_account_ids: path.endsWith('/calendars') ? [1] : [],
            calendar_account_ids: fields.permissions_form === 'combined' || path.endsWith('/calendars') ? [] : [2, 3],
        });
        const logs = f.sqlite.prepare('SELECT details FROM audit_logs').all();
        expect(logs).toHaveLength(1);
        expect(JSON.parse(logs[0].details as string).after).toEqual({ ...f.grants(), is_active: 1 });
    }
);

it.each(paths)(
    'rolls back grants, name, and auth code on audit failure for $path ($action)',
    async ({ path, fields }) => {
        const f = fixture();
        f.sqlite.exec(
            "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit unavailable'); END"
        );
        const response = await f.request(path, { ...fields, account_ids: '2', calendar_account_ids: '1' });
        expect(response.headers.get('location')).toContain('error=');
        expect(f.grants()).toEqual(before);
        expect(f.sqlite.prepare('SELECT name FROM mcp_clients').get()?.name).toBe('Original private name');
        expect(f.sqlite.prepare('SELECT * FROM oauth_auth_codes').all()).toEqual([]);
        expect(f.sqlite.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
    }
);

it.each(paths)(
    'rolls back the success audit and earlier mutations on grant failure for $path ($action)',
    async ({ path, fields }) => {
        const f = fixture();
        const table = path.endsWith('/calendars') ? 'mcp_client_calendar_accounts' : 'mcp_client_accounts';
        f.sqlite.exec(
            `CREATE TRIGGER fail_grants BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'Grant unavailable'); END`
        );
        const response = await f.request(path, { ...fields, account_ids: '2', calendar_account_ids: '1' });
        expect(response.headers.get('location')).toContain('error=');
        expect(f.grants()).toEqual(before);
        expect(f.sqlite.prepare('SELECT name FROM mcp_clients').get()?.name).toBe('Original private name');
        expect(f.sqlite.prepare('SELECT * FROM oauth_auth_codes').all()).toEqual([]);
        expect(f.sqlite.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
    }
);

it('rolls back consent grants and success audit when auth code insertion fails', async () => {
    const f = fixture();
    f.sqlite.exec(
        "CREATE TRIGGER fail_code BEFORE INSERT ON oauth_auth_codes BEGIN SELECT RAISE(ABORT, 'Code unavailable'); END"
    );
    const consent = paths[3];
    await f.request(consent.path, { ...consent.fields, account_ids: '2' });
    expect(f.grants()).toEqual(before);
    expect(f.sqlite.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
    expect(f.sqlite.prepare('SELECT * FROM oauth_auth_codes').all()).toEqual([]);
});

it('snapshots grants inside the batch, not from earlier validation reads', async () => {
    const f = fixture();
    f.beforeBatch(() =>
        f.sqlite.exec('INSERT INTO mcp_client_accounts (mcp_client_id, email_account_id) VALUES (11, 3)')
    );
    await f.request('/agents/11/accounts', { name: 'Renamed', account_ids: '2' });
    const log = f.sqlite.prepare('SELECT details FROM audit_logs').get();
    expect(log).toBeDefined();
    expect(JSON.parse(log!.details as string).before.email_account_ids).toEqual([1, 3]);
});

it('rolls back both grant sets when calendar insertion fails after email replacement', async () => {
    const f = fixture();
    f.sqlite.exec(
        "CREATE TRIGGER fail_calendar BEFORE INSERT ON mcp_client_calendar_accounts BEGIN SELECT RAISE(ABORT, 'Calendar unavailable'); END"
    );
    await f.request('/agents/11/accounts', {
        name: 'Renamed',
        permissions_form: 'combined',
        account_ids: '2',
        calendar_account_ids: '1',
    });
    expect(f.grants()).toEqual(before);
    expect(f.sqlite.prepare('SELECT name FROM mcp_clients').get()?.name).toBe('Original private name');
    expect(f.sqlite.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
});

it('supports helper calls without an admin ID and audits sorted, deduplicated selections', async () => {
    const f = fixture();
    await updateAgentNameAndAccounts(f.db, 11, 'Renamed', [3, 2, 3], [3, 1, 3]);
    const log = f.sqlite.prepare('SELECT details FROM audit_logs').get();
    expect(JSON.parse(log!.details as string)).toEqual({
        agent_id: 11,
        admin_user_id: null,
        before: { ...before, is_active: 1 },
        after: { email_account_ids: [2, 3], calendar_account_ids: [1, 3], is_active: 1 },
    });
    expect(f.grants()).toEqual({ email_account_ids: [2, 3], calendar_account_ids: [1, 3] });
});

it.each([
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    1.5,
    -1,
    0,
    'private@example.com',
    '0xb',
    '11e0',
    '011',
    '+11',
    '11.0',
    ' 11',
    '11 ',
    '11\n',
    '',
    '9007199254740993',
])('rejects unsafe audit identities (%s)', (id) => {
    const f = fixture();
    expect(() => permissionAuditStatement(f.db, id, 7, 'agent_permissions_updated', [])).toThrow(
        'Invalid permission audit identity'
    );
    if (typeof id === 'number') {
        expect(() => permissionAuditStatement(f.db, 11, id, 'agent_permissions_updated', [])).toThrow(
            'Invalid permission audit identity'
        );
    }
    expect(f.grants()).toEqual(before);
    expect(f.sqlite.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
});

it.each([11, '11'])('accepts canonical numeric and decimal string audit identities (%s)', async (id) => {
    const f = fixture();
    await permissionAuditStatement(f.db, id, 7, 'agent_permissions_updated').run();
    const log = f.sqlite.prepare('SELECT target, details FROM audit_logs').get();
    expect(log?.target).toBe('agent:11');
    expect(JSON.parse(log!.details as string).agent_id).toBe(11);
    expect(f.grants()).toEqual(before);
});

it('resolves the public client ID inside the batch snapshot', async () => {
    const f = fixture();
    f.beforeBatch(() => f.sqlite.exec("UPDATE mcp_clients SET client_id = 'ez-current-public-client' WHERE id = 11"));
    await f.request('/agents/11/accounts', { name: 'Renamed', account_ids: '2' });
    expect(f.sqlite.prepare('SELECT client_id, target FROM audit_logs').get()).toEqual({
        client_id: 'ez-current-public-client',
        target: 'agent:11',
    });
});

it.each([1, 0])('audits atomic agent revocation from is_active=%s without deleting grants', async (isActive) => {
    const f = fixture();
    f.sqlite.prepare('UPDATE mcp_clients SET is_active = ? WHERE id = 11').run(isActive);
    const response = await f.request('/agents/11/revoke', {});
    expect(response.headers.get('location')).toContain('message=');
    expect(f.sqlite.prepare('SELECT is_active FROM mcp_clients WHERE id = 11').get()?.is_active).toBe(0);
    expect(f.grants()).toEqual(before);
    const logs = f.sqlite.prepare('SELECT * FROM audit_logs').all();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
        client_id: 'ez-public-client',
        client_name: null,
        action: 'agent_revoked',
        target: 'agent:11',
        success: 1,
        error_message: null,
    });
    expect(JSON.parse(logs[0].details as string)).toEqual({
        agent_id: 11,
        admin_user_id: 7,
        before: { ...before, is_active: isActive },
        after: { ...before, is_active: 0 },
    });
    expect(JSON.stringify(logs)).not.toContain('private');
});

it.each(['0xb', '11e0'])('rejects noncanonical revocation IDs without writes or a success audit (%s)', async (id) => {
    const f = fixture();
    const changesBefore = f.sqlite.prepare('SELECT total_changes() AS changes').get()?.changes;
    const response = await f.request(`/agents/${id}/revoke`, {});
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!, 'https://example.com');
    expect(location.searchParams.get('error')).toBe('Invalid permission audit identity');
    expect(location.searchParams.has('message')).toBe(false);
    expect(f.sqlite.prepare('SELECT total_changes() AS changes').get()?.changes).toBe(changesBefore);
    expect(f.sqlite.prepare('SELECT is_active FROM mcp_clients WHERE id = 11').get()?.is_active).toBe(1);
    expect(f.grants()).toEqual(before);
    expect(f.sqlite.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
});

it.each(['audit', 'revoke'])('rolls back revocation and its audit when %s fails', async (failure) => {
    const f = fixture();
    f.sqlite.exec(
        failure === 'audit'
            ? "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'Audit unavailable'); END"
            : "CREATE TRIGGER fail_revoke BEFORE UPDATE OF is_active ON mcp_clients BEGIN SELECT RAISE(ABORT, 'Revoke unavailable'); END"
    );
    const response = await f.request('/agents/11/revoke', {});
    expect(response.headers.get('location')).toContain('error=');
    expect(f.sqlite.prepare('SELECT is_active FROM mcp_clients WHERE id = 11').get()?.is_active).toBe(1);
    expect(f.grants()).toEqual(before);
    expect(f.sqlite.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
});

it('does not invent an audit identity for an agent that does not exist', async () => {
    const f = fixture();
    await f.request('/agents/999/revoke', {});
    expect(f.sqlite.prepare('SELECT * FROM audit_logs').all()).toEqual([]);
    expect(f.grants()).toEqual(before);
});
