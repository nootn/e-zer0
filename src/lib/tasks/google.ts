// Google Tasks API client
// Docs: https://developers.google.com/workspace/tasks/reference/rest/v1

const TASKS_API_BASE = 'https://tasks.googleapis.com/tasks/v1';

export interface GoogleTaskList {
    id: string;
    title: string;
}

export interface GoogleTask {
    id: string;
    title: string;
    notes?: string;
    status: 'needsAction' | 'completed';
    due?: string; // RFC3339 (only the date portion is honored by Google)
    completed?: string;
    updated?: string;
}

async function tasksFetch(accessToken: string, path: string, options?: RequestInit): Promise<any> {
    const res = await fetch(`${TASKS_API_BASE}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Google Tasks API error (${res.status}): ${err}`);
    }

    // DELETE returns 204 No Content
    if (res.status === 204) return {};
    return res.json();
}

function mapGoogleTask(t: any): GoogleTask {
    return {
        id: t.id,
        title: t.title || '',
        notes: t.notes,
        status: t.status === 'completed' ? 'completed' : 'needsAction',
        due: t.due,
        completed: t.completed,
        updated: t.updated,
    };
}

export async function listGoogleTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
    // Page through every task list — tasklists.list defaults to 20 and paginates via nextPageToken.
    const lists: GoogleTaskList[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
        const params = new URLSearchParams({ maxResults: '100' });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await tasksFetch(accessToken, `/users/@me/lists?${params}`);
        for (const l of data.items || []) {
            lists.push({ id: l.id, title: l.title });
        }
        pageToken = data.nextPageToken;
    } while (pageToken && ++pages < 50);
    return lists;
}

// Page through tasks in a list. Pass maxResults to cap the total; omit to return every task.
export async function listGoogleTasks(
    accessToken: string,
    taskListId = '@default',
    showCompleted = false,
    maxResults?: number
): Promise<GoogleTask[]> {
    const tasks: GoogleTask[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
        const remaining = maxResults !== undefined ? maxResults - tasks.length : 100;
        const pageSize = Math.min(100, remaining > 0 ? remaining : 100);
        const params = new URLSearchParams({
            maxResults: String(pageSize),
            showCompleted: String(showCompleted),
            showHidden: String(showCompleted),
        });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await tasksFetch(accessToken, `/lists/${encodeURIComponent(taskListId)}/tasks?${params}`);
        for (const t of data.items || []) {
            tasks.push(mapGoogleTask(t));
        }
        pageToken = data.nextPageToken;
        if (maxResults !== undefined && tasks.length >= maxResults) break;
    } while (pageToken && ++pages < 50);
    return maxResults !== undefined ? tasks.slice(0, maxResults) : tasks;
}

export async function createGoogleTask(
    accessToken: string,
    taskListId: string,
    task: { title: string; notes?: string; due?: string }
): Promise<GoogleTask> {
    const body: any = { title: task.title };
    if (task.notes) body.notes = task.notes;
    if (task.due) body.due = task.due;
    const data = await tasksFetch(accessToken, `/lists/${encodeURIComponent(taskListId)}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
    return mapGoogleTask(data);
}

export async function updateGoogleTask(
    accessToken: string,
    taskListId: string,
    taskId: string,
    updates: { title?: string; notes?: string; due?: string; status?: 'needsAction' | 'completed' }
): Promise<GoogleTask> {
    const body: any = {};
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.notes !== undefined) body.notes = updates.notes;
    if (updates.due !== undefined) body.due = updates.due;
    if (updates.status !== undefined) {
        body.status = updates.status;
        // Reopening a task requires clearing the completed timestamp
        if (updates.status === 'needsAction') body.completed = null;
    }
    const data = await tasksFetch(
        accessToken,
        `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: 'PATCH', body: JSON.stringify(body) }
    );
    return mapGoogleTask(data);
}

export async function deleteGoogleTask(accessToken: string, taskListId: string, taskId: string): Promise<void> {
    await tasksFetch(accessToken, `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
    });
}
