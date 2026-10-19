import { afterEach, expect, it, vi } from 'vitest';
import { getProviderCalendarEvents, listProviderCalendars } from './calendar';
import { getGoogleAuthUrl } from './oauth/google';
import { getMicrosoftAuthUrl, refreshMicrosoftToken } from './oauth/microsoft';
import agents, { updateCalendarGrants } from '../routes/agents';

afterEach(() => vi.unstubAllGlobals());
const start = '2026-10-05T00:00:00+10:00';
const end = '2026-10-06T00:00:00+10:00';

it('requests read-only calendar scopes and no Microsoft sending permission', () => {
    const google = new URL(getGoogleAuthUrl('client', 'https://example.com/callback', 'state')).searchParams.get(
        'scope'
    );
    expect(google).toContain('calendar.calendarlist.readonly');
    expect(google).toContain('calendar.events.readonly');
    const microsoft = new URL(getMicrosoftAuthUrl('client', 'https://example.com/callback', 'state')).searchParams.get(
        'scope'
    );
    expect(microsoft).toContain('Calendars.Read');
    expect(microsoft).not.toContain('Calendars.ReadWrite');
    expect(microsoft).not.toContain('Mail.Send');
});

it('refreshes Microsoft tokens without adding scopes to old consent', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
            expect(new URLSearchParams(init.body as string).has('scope')).toBe(false);
            return Response.json({ access_token: 'new', expires_in: 3600 });
        })
    );
    await refreshMicrosoftToken('refresh', 'client', 'secret');
});

it('expands recurring Google events and preserves all-day dates and pagination', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
            const parsed = new URL(url);
            expect(parsed.pathname).toContain('/calendars/calendar%2Fid/events');
            expect(parsed.searchParams.get('timeMin')).toBe(start);
            expect(parsed.searchParams.get('timeMax')).toBe(end);
            expect(parsed.searchParams.get('singleEvents')).toBe('true');
            expect(parsed.searchParams.get('pageToken')).toBe('cursor');
            expect(init.method).toBeUndefined();
            return Response.json({
                items: [
                    { id: 'event', summary: 'Holiday', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } },
                ],
                nextPageToken: 'next',
            });
        })
    );
    const result = await getProviderCalendarEvents('google', 'token', 'calendar/id', start, end, 50, 'cursor');
    expect(result.events[0]).toMatchObject({ all_day: true, start: '2026-10-05', end: '2026-10-06' });
    expect(result.next_page_token).toBe('next');
});

it('reads Microsoft calendarView occurrences in UTC and preserves original time zone', async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: RequestInit) => {
            expect(new URL(url).pathname).toContain('/calendars/id/calendarView');
            expect(new URL(url).searchParams.get('startDateTime')).toBe(start);
            expect(init.headers).toMatchObject({ Prefer: 'outlook.body-content-type="text", outlook.timezone="UTC"' });
            return Response.json({
                value: [
                    {
                        id: 'event',
                        subject: 'Meeting',
                        start: { dateTime: '2026-10-05T00:00:00', timeZone: 'UTC' },
                        end: { dateTime: '2026-10-05T01:00:00', timeZone: 'UTC' },
                        originalStartTimeZone: 'E. Australia Standard Time',
                        isCancelled: true,
                    },
                ],
                '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendars/id/calendarView?$skiptoken=next',
            });
        })
    );
    const result = await getProviderCalendarEvents('microsoft', 'token', 'id', start, end);
    expect(result.events[0]).toMatchObject({
        start: '2026-10-05T00:00:00Z',
        time_zone: 'E. Australia Standard Time',
        cancelled: true,
    });
    expect(result.next_page_token).toContain('$skiptoken=next');
});

it.each([
    'https://attacker.example/calendars',
    'https://graph.microsoft.com/v1.0/me/messages',
    'https://graph.microsoft.com/v1.0/users/other/calendars',
])('blocks foreign or out-of-scope page tokens: %s', async (page) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(listProviderCalendars('microsoft', 'secret-token', page)).rejects.toThrow(
        'Invalid calendar page token'
    );
    expect(fetch).not.toHaveBeenCalled();
});

it.each([
    ['bad', end],
    [end, start],
    [start, '2028-10-05T00:00:00Z'],
])('rejects invalid/unbounded date ranges before fetching', async (from, to) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(getProviderCalendarEvents('google', 'token', 'primary', from, to)).rejects.toThrow('Calendar range');
    expect(fetch).not.toHaveBeenCalled();
});

it.each(['google', 'microsoft'] as const)('lists calendars with an explicit continuation (%s)', async (provider) => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
            Response.json(
                provider === 'google'
                    ? { items: [{ id: 'id', summary: 'Work', primary: true }], nextPageToken: 'next' }
                    : { value: [{ id: 'id', name: 'Work', isDefaultCalendar: true }], '@odata.nextLink': 'next' }
            )
        )
    );
    expect(await listProviderCalendars(provider, 'token')).toMatchObject({
        calendars: [{ id: 'id', name: 'Work', primary: true }],
        next_page_token: 'next',
    });
});

it('renders calendar grants independently of email grants, including inactive accounts', async () => {
    const db = {
        prepare(sql: string) {
            return {
                bind() {
                    return this;
                },
                async all() {
                    if (sql.includes('FROM mcp_clients'))
                        return { results: [{ id: 1, name: 'Agent', client_id: 'client', is_active: 1 }] };
                    if (sql.includes('FROM mcp_client_calendar_accounts'))
                        return { results: [{ email_account_id: 3 }] };
                    if (sql.includes('FROM mcp_client_accounts'))
                        return { results: [{ mcp_client_id: 1, email_account_id: 2 }] };
                    const accounts = [
                        { id: 2, alias: 'Mail only', email_address: 'mail@example.com', status: 'active' },
                        { id: 3, alias: 'Inactive calendar', email_address: 'calendar@example.com', status: 'expired' },
                    ];
                    return {
                        results: sql.includes('WHERE status')
                            ? accounts.filter((a) => a.status === 'active')
                            : accounts,
                    };
                },
            };
        },
    } as unknown as D1Database;
    const response = await agents.request('/?edit=1', {}, { DB: db });
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('action="/agents/1/accounts"');
    expect(html).not.toContain('action="/agents/1/calendars"');
    expect(html.match(/<input[^>]*name="calendar_account_ids" value="2"[^>]*>/)?.[0]).not.toContain('checked');
    expect(html).toMatch(/name="calendar_account_ids" value="3"[^>]*checked/);
    expect(html).toContain('Inactive calendar');
});

it('validates selections before atomically replacing only calendar grants', async () => {
    const batch = vi.fn(async () => []);
    const sql: string[] = [];
    const db = {
        prepare(query: string) {
            sql.push(query);
            return {
                bind() {
                    return this;
                },
                first: async () => ({ id: 1 }),
                all: async () => ({ results: [{ id: 2 }] }),
            };
        },
        batch,
    } as unknown as D1Database;
    await expect(updateCalendarGrants(db, '1', [999])).rejects.toThrow('Invalid calendar account');
    expect(batch).not.toHaveBeenCalled();
    await updateCalendarGrants(db, '1', [2, 2]);
    expect(batch.mock.calls[0][0]).toHaveLength(2);
    expect(sql.some((query) => query.includes('DELETE FROM mcp_client_accounts '))).toBe(false);
    await updateCalendarGrants(db, '1', []);
    expect(batch.mock.calls[1][0]).toHaveLength(1);
});
