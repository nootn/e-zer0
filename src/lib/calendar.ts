import type {
    CalendarSummary,
    CalendarEvent,
    GoogleCalendarEvent,
    MicrosoftCalendarEvent,
    GoogleCalendarSummary,
    MicrosoftCalendarSummary,
    CalendarPage,
} from '../types';

// Read-only requests; provider errors must not leak calendar content into audit logs.
import { providerRequest } from './provider-request';
async function readCalendar<T>(url: URL, token: string): Promise<T> {
    const response = await providerRequest('calendar', url.toString(), {
        headers: {
            Authorization: `Bearer ${token}`,
            Prefer: 'outlook.body-content-type="text", outlook.timezone="UTC"',
        },
    });
    if (!response.ok)
        throw new Error(
            `Calendar API error (${response.status}). Reconnect the account if calendar consent is missing.`
        );
    return response.json() as Promise<T>;
}

function calendarUrl(provider: 'google' | 'microsoft', path: string, pageToken?: string): URL {
    const url = new URL(
        provider === 'google'
            ? `https://www.googleapis.com/calendar/v3/${path}`
            : `https://graph.microsoft.com/v1.0/me/${path}`
    );
    if (pageToken && provider === 'microsoft') {
        const next = new URL(pageToken);
        if (next.origin !== url.origin || next.pathname !== url.pathname || next.username || next.password)
            throw new Error('Invalid calendar page token');
        return next;
    }
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    return url;
}

export async function listProviderCalendars(
    provider: 'google' | 'microsoft',
    token: string,
    pageToken?: string
): Promise<{ calendars: CalendarSummary[]; next_page_token?: string }> {
    const url = calendarUrl(provider, provider === 'google' ? 'users/me/calendarList' : 'calendars', pageToken);
    if (provider === 'google') {
        url.searchParams.set('maxResults', '100');
        const result = await readCalendar<CalendarPage<GoogleCalendarSummary>>(url, token);
        return {
            calendars: (result.items || []).map((c) => ({
                id: c.id,
                name: c.summary || '',
                primary: !!c.primary,
                time_zone: c.timeZone,
            })),
            next_page_token: result.nextPageToken,
        };
    }
    url.searchParams.set('$top', '100');
    const result = await readCalendar<CalendarPage<MicrosoftCalendarSummary>>(url, token);
    return {
        calendars: (result.value || []).map((c) => ({ id: c.id, name: c.name || '', primary: !!c.isDefaultCalendar })),
        next_page_token: result['@odata.nextLink'],
    };
}

export async function getProviderCalendarEvents(
    provider: 'google' | 'microsoft',
    token: string,
    calendarId: string,
    start: string,
    end: string,
    count = 50,
    pageToken?: string
): Promise<{ events: CalendarEvent[]; next_page_token?: string }> {
    const duration = Date.parse(end) - Date.parse(start);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 366 * 86400000)
        throw new Error('Calendar range must be positive and at most 366 days');
    const encodedId =
        provider === 'microsoft'
            ? encodeURIComponent(calendarId).replace(/%3D/gi, '=')
            : encodeURIComponent(calendarId);
    const url = calendarUrl(
        provider,
        `calendars/${encodedId}/${provider === 'google' ? 'events' : 'calendarView'}`,
        pageToken
    );
    if (provider === 'google') {
        url.searchParams.set('timeMin', start);
        url.searchParams.set('timeMax', end);
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('orderBy', 'startTime');
        url.searchParams.set('maxResults', String(count));
        const result = await readCalendar<CalendarPage<GoogleCalendarEvent>>(url, token);
        return {
            events: (result.items || []).map((e) => ({
                id: e.id,
                title: e.summary || '',
                description: e.description || '',
                location: e.location || '',
                start: e.start?.dateTime || e.start?.date || '',
                end: e.end?.dateTime || e.end?.date || '',
                time_zone: e.start?.timeZone || result.timeZone,
                all_day: !!e.start?.date,
                cancelled: e.status === 'cancelled',
            })),
            next_page_token: result.nextPageToken,
        };
    }
    url.searchParams.set('startDateTime', start);
    url.searchParams.set('endDateTime', end);
    url.searchParams.set('$top', String(count));
    url.searchParams.set('$orderby', 'start/dateTime');
    const result = await readCalendar<CalendarPage<MicrosoftCalendarEvent>>(url, token);
    const utc = (value: string): string => (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
    return {
        events: (result.value || []).map((e) => ({
            id: e.id,
            title: e.subject || '',
            description: e.body?.content || '',
            location: e.location?.displayName || '',
            start: utc(e.start.dateTime),
            end: utc(e.end.dateTime),
            time_zone: e.originalStartTimeZone || e.start.timeZone,
            all_day: !!e.isAllDay,
            cancelled: !!e.isCancelled,
        })),
        next_page_token: result['@odata.nextLink'],
    };
}
