import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listGoogleTaskLists, listGoogleTasks, createGoogleTask, deleteGoogleTask } from './google';

function mockResponse(body: any, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

describe('Google Tasks API', () => {
    let mockFetch: any;

    beforeEach(() => {
        mockFetch = vi.fn();
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('listGoogleTaskLists calls correct endpoint and maps items', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                items: [
                    { id: 'list1', title: 'My Tasks' },
                    { id: 'list2', title: 'Work' },
                ],
            })
        );

        const result = await listGoogleTaskLists('test-token');

        expect(result).toEqual([
            { id: 'list1', title: 'My Tasks' },
            { id: 'list2', title: 'Work' },
        ]);
        expect(mockFetch.mock.calls[0][0]).toBe('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100');
    });

    it('listGoogleTaskLists follows nextPageToken to fetch all lists', async () => {
        mockFetch
            .mockResolvedValueOnce(mockResponse({ items: [{ id: 'list1', title: 'A' }], nextPageToken: 'tok2' }))
            .mockResolvedValueOnce(mockResponse({ items: [{ id: 'list2', title: 'B' }] }));

        const result = await listGoogleTaskLists('test-token');

        expect(result).toEqual([
            { id: 'list1', title: 'A' },
            { id: 'list2', title: 'B' },
        ]);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch.mock.calls[1][0]).toContain('pageToken=tok2');
    });

    it('listGoogleTasks maps status correctly', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                items: [
                    { id: 'task1', title: 'Buy milk', status: 'needsAction' },
                    { id: 'task2', title: 'Done task', status: 'completed' },
                    { id: 'task3', title: 'Another task' }, // No status
                ],
            })
        );

        const result = await listGoogleTasks('test-token', '@default', false, 100);

        expect(result).toHaveLength(3);
        expect(result[0].status).toBe('needsAction');
        expect(result[1].status).toBe('completed');
        expect(result[2].status).toBe('needsAction');
    });

    it('listGoogleTasks follows nextPageToken to fetch all tasks', async () => {
        mockFetch
            .mockResolvedValueOnce(
                mockResponse({ items: [{ id: 't1', title: 'A', status: 'needsAction' }], nextPageToken: 'p2' })
            )
            .mockResolvedValueOnce(mockResponse({ items: [{ id: 't2', title: 'B', status: 'needsAction' }] }));

        const result = await listGoogleTasks('test-token', '@default', false);

        expect(result.map((t) => t.id)).toEqual(['t1', 't2']);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch.mock.calls[1][0]).toContain('pageToken=p2');
    });

    it('createGoogleTask POSTs with title and due date', async () => {
        mockFetch.mockResolvedValueOnce(
            mockResponse({
                id: 'newtask',
                title: 'New task',
                due: '2026-06-25',
                status: 'needsAction',
            })
        );

        const result = await createGoogleTask('test-token', '@default', {
            title: 'New task',
            due: '2026-06-25T00:00:00Z',
        });

        expect(result.id).toBe('newtask');
        expect(result.title).toBe('New task');
        expect(result.due).toBe('2026-06-25');

        expect(mockFetch).toHaveBeenCalled();
        const call = mockFetch.mock.calls[0];
        expect(call[0]).toBe('https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks');
        expect(call[1].method).toBe('POST');
        const body = JSON.parse(call[1].body);
        expect(body.title).toBe('New task');
        expect(body.due).toBe('2026-06-25T00:00:00Z');
    });

    it('deleteGoogleTask issues DELETE and handles 204 response', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse({}, 204));

        await deleteGoogleTask('test-token', '@default', 'task123');

        expect(mockFetch).toHaveBeenCalled();
        const call = mockFetch.mock.calls[0];
        expect(call[0]).toBe('https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks/task123');
        expect(call[1].method).toBe('DELETE');
    });
});
