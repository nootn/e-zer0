import { expect, it, vi } from 'vitest';
import agents, { updateAgentNameAndAccounts } from './agents';

function fixture() {
    const statements: { sql: string; values: unknown[] }[] = [];
    const batch = vi.fn(async () => []);
    const db = {
        prepare(sql: string) {
            const statement = {
                sql,
                values: [] as unknown[],
                bind(...values: unknown[]) {
                    this.values = values;
                    return this;
                },
                first: async () => ({ id: 1, name: 'Agent' }),
                async all() {
                    if (sql.includes('FROM mcp_clients'))
                        return {
                            results: [
                                { id: 1, name: 'Agent', client_id: 'test', is_active: 1, created_at: '2026-10-01' },
                            ],
                        };
                    if (sql.includes('FROM mcp_client_calendar_accounts'))
                        return { results: [{ email_account_id: 2 }] };
                    if (sql.includes('FROM mcp_client_accounts'))
                        return { results: [{ mcp_client_id: 1, email_account_id: 1 }] };
                    return {
                        results: [
                            { id: 1, email_address: 'one@example.com', alias: 'one@example.com', status: 'active' },
                            { id: 2, email_address: 'two@example.com', alias: 'Work', status: 'expired' },
                        ],
                    };
                },
            };
            statements.push(statement);
            return statement;
        },
        batch,
    } as unknown as D1Database;
    return { db, batch, statements };
}

it('uses one account table and one save/cancel pair when editing', async () => {
    const { db } = fixture();
    const response = await agents.request('/?edit=1', {}, { DB: db });
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).not.toContain('Create New Agent');
    expect(html).not.toContain('/agents/1/calendars');
    expect(html.match(/>Cancel</g)).toHaveLength(1);
    expect(html.match(/>Save Changes</g)).toHaveLength(1);
    expect(html).not.toContain('one@example.com (one@example.com)');
    expect(html).toContain('two@example.com (Work)');
    expect(html.match(/<th scope="row"/g)).toHaveLength(2);
    expect(html.match(/<input[^>]*name="account_ids" value="1"[^>]*>/)?.[0]).toContain('checked');
    expect(html.match(/<input[^>]*name="calendar_account_ids" value="2"[^>]*>/)?.[0]).toContain('checked');
    expect(html).toContain('expired');
});

it('uses the same account table with no grants preselected when creating', async () => {
    const { db } = fixture();
    const html = await (await agents.request('/', {}, { DB: db })).text();
    expect(html).toContain('action="/agents/create"');
    expect(html.match(/<th scope="row"/g)).toHaveLength(2);
    expect(html.match(/<input[^>]*type="checkbox"[^>]*>/g)).toHaveLength(4);
    for (const checkbox of html.match(/<input[^>]*type="checkbox"[^>]*>/g) || [])
        expect(checkbox).not.toContain('checked');
});

it('saves name and both grant sets in one batch, deduplicates, and allows empty grants', async () => {
    const { db, batch } = fixture();
    await updateAgentNameAndAccounts(db, 1, 'New name', [1, 1], [2, 2]);
    const statements = batch.mock.calls[0][0] as unknown as { sql: string; values: unknown[] }[];
    expect(statements).toHaveLength(5);
    expect(statements[0].values).toEqual(['New name', 1]);
    expect(statements[2].values).toEqual([1, 1]);
    expect(statements[4].values).toEqual([1, 2]);
    expect(statements[3].sql).toContain('DELETE FROM mcp_client_calendar_accounts');
    await updateAgentNameAndAccounts(db, 1, 'New name', [], []);
    expect(batch.mock.calls[1][0]).toHaveLength(3);
});

it.each([[999], [1.5], [NaN]])('rejects invalid grants before any edits (%s)', async (invalid) => {
    const { db, batch } = fixture();
    await expect(updateAgentNameAndAccounts(db, 1, 'Name', [invalid], [])).rejects.toThrow('Invalid account selection');
    await expect(updateAgentNameAndAccounts(db, 1, 'Name', [], [invalid])).rejects.toThrow('Invalid account selection');
    expect(batch).not.toHaveBeenCalled();
});

it('handles combined-save failure without reporting success', async () => {
    const { db, batch } = fixture();
    batch.mockRejectedValueOnce(new Error('Batch failed'));
    const response = await agents.request(
        '/1/accounts',
        {
            method: 'POST',
            body: new URLSearchParams({
                name: 'New name',
                account_ids: '1',
                calendar_account_ids: '2',
                permissions_form: 'combined',
            }),
        },
        { DB: db }
    );
    expect(response.headers.get('location')).toContain('edit=1&error=Batch%20failed');
    expect(batch).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
    'preserves old-page calendar grants but clears an empty combined selection (%s)',
    async (combined) => {
        const { db, batch } = fixture();
        const body = new URLSearchParams({ name: 'Agent' });
        if (combined) body.set('permissions_form', 'combined');
        await agents.request('/1/accounts', { method: 'POST', body }, { DB: db });
        const statements = batch.mock.calls[0][0] as unknown as { sql: string }[];
        expect(statements.some((statement) => statement.sql.includes('mcp_client_calendar_accounts'))).toBe(combined);
    }
);

it('creates an agent and both grant sets atomically and renders the same create form', async () => {
    const { db, batch } = fixture();
    const response = await agents.request(
        '/create',
        {
            method: 'POST',
            body: new URLSearchParams({ name: 'New agent', account_ids: '1', calendar_account_ids: '2' }),
        },
        { DB: db }
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('New Agent Created: New agent');
    expect(html).toContain('Calendar (read-only)');
    const statements = batch.mock.calls[0][0] as unknown as { sql: string; values: unknown[] }[];
    expect(statements).toHaveLength(3);
    expect(statements[0].sql).toContain('INSERT INTO mcp_clients');
    expect(statements[1].sql).toContain('INSERT INTO mcp_client_accounts');
    expect(statements[2].sql).toContain('INSERT INTO mcp_client_calendar_accounts');
    expect(statements[1].values[1]).toBe(statements[0].values[1]);
    expect(statements[2].values[1]).toBe(statements[0].values[1]);
});
