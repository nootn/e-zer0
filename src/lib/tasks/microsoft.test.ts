import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listMsTaskLists, getMsDefaultListId, listMsTasks, createMsTask } from './microsoft';

function mockResponse(body: any, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

describe('Microsoft To Do API', () => {
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('listMsTaskLists maps value array with displayName and wellknownListName', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                value: [
                    { id: 'list1', displayName: 'Tasks', wellknownListName: 'defaultList' },
                    { id: 'list2', displayName: 'Shopping' },
                ],
            })
        );

        const result = await listMsTaskLists('test-token');

        expect(result).toEqual([
            { id: 'list1', title: 'Tasks', wellknownListName: 'defaultList' },
            { id: 'list2', title: 'Shopping', wellknownListName: undefined },
        ]);
    });

    it('listMsTaskLists follows @odata.nextLink to fetch all lists', async () => {
        mockFetch
            .mockResolvedValueOnce(
                mockResponse({
                    value: [{ id: 'list1', displayName: 'A' }],
                    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/todo/lists?$skiptoken=abc',
                })
            )
            .mockResolvedValueOnce(mockResponse({ value: [{ id: 'list2', displayName: 'B' }] }));

        const result = await listMsTaskLists('test-token');

        expect(result.map((l) => l.id)).toEqual(['list1', 'list2']);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/me/todo/lists?$skiptoken=abc');
    });

    it('getMsDefaultListId returns defaultList when found', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                value: [
                    { id: 'list1', displayName: 'Tasks', wellknownListName: 'defaultList' },
                    { id: 'list2', displayName: 'Other' },
                ],
            })
        );

        const result = await getMsDefaultListId('test-token');

        expect(result).toBe('list1');
    });

    it('getMsDefaultListId returns first list when defaultList not found', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                value: [
                    { id: 'list1', displayName: 'Tasks' },
                    { id: 'list2', displayName: 'Other' },
                ],
            })
        );

        const result = await getMsDefaultListId('test-token');

        expect(result).toBe('list1');
    });

    it('listMsTasks includes filter for incomplete tasks by default', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                value: [
                    { id: 'task1', title: 'Task 1', status: 'notStarted' },
                    { id: 'task2', title: 'Task 2', status: 'inProgress' },
                ],
            })
        );

        await listMsTasks('test-token', 'list1', false, 100);

        const call = mockFetch.mock.calls[0];
        expect(call[0]).toContain('$filter=');
        expect(decodeURIComponent(call[0])).toContain("status ne 'completed'");
    });

    it('listMsTasks maps dueDateTime and body.content', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                value: [
                    {
                        id: 'task1',
                        title: 'Buy groceries',
                        status: 'notStarted',
                        dueDateTime: { dateTime: '2026-06-25T00:00:00' },
                        body: { content: 'Milk, eggs, bread' },
                        lastModifiedDateTime: '2026-06-20T10:00:00Z',
                    },
                ],
            })
        );

        const result = await listMsTasks('test-token', 'list1', false, 100);

        expect(result[0].due).toBe('2026-06-25T00:00:00');
        expect(result[0].notes).toBe('Milk, eggs, bread');
        expect(result[0].updated).toBe('2026-06-20T10:00:00Z');
    });

    it('listMsTasks follows @odata.nextLink to fetch all tasks', async () => {
        mockFetch
            .mockResolvedValueOnce(
                mockResponse({
                    value: [{ id: 't1', title: 'A', status: 'notStarted' }],
                    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/todo/lists/list1/tasks?$skiptoken=xyz',
                })
            )
            .mockResolvedValueOnce(mockResponse({ value: [{ id: 't2', title: 'B', status: 'notStarted' }] }));

        const result = await listMsTasks('test-token', 'list1', false);

        expect(result.map((t) => t.id)).toEqual(['t1', 't2']);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch.mock.calls[1][0]).toBe(
            'https://graph.microsoft.com/v1.0/me/todo/lists/list1/tasks?$skiptoken=xyz'
        );
    });

    it('createMsTask POSTs with dueDateTime without trailing Z and timeZone UTC', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                id: 'newtask',
                title: 'New task',
                dueDateTime: { dateTime: '2026-06-25T00:00:00', timeZone: 'UTC' },
                status: 'notStarted',
            })
        );

        await createMsTask('test-token', 'list1', {
            title: 'New task',
            notes: 'Some notes',
            due: '2026-06-25T00:00:00Z',
        });

        const call = mockFetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.dueDateTime.dateTime).toBe('2026-06-25T00:00:00');
        expect(body.dueDateTime.timeZone).toBe('UTC');
        expect(body.dueDateTime.dateTime).not.toContain('Z');
        expect(body.body.content).toBe('Some notes');
        expect(body.body.contentType).toBe('text');
    });
});
