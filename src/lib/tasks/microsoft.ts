// Microsoft To Do API client (Microsoft Graph)
// Docs: https://learn.microsoft.com/en-us/graph/api/resources/todo-overview

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0/me';

export interface MsTaskList {
    id: string;
    title: string;
    wellknownListName?: string;
}

export interface MsTask {
    id: string;
    title: string;
    notes?: string;
    status: string; // notStarted | inProgress | completed | waitingOnOthers | deferred
    due?: string;
    completed?: string;
    updated?: string;
}

async function graphFetch(accessToken: string, path: string, options?: RequestInit): Promise<any> {
    // `path` may be a relative Graph path or an absolute @odata.nextLink URL (used for pagination).
    const url = path.startsWith('http') ? path : `${GRAPH_API_BASE}${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Graph API error (${res.status}): ${err}`);
    }

    if (res.status === 204) return {};
    return res.json();
}

// Graph dateTimeTimeZone expects a local-style datetime without a trailing 'Z'.
function toGraphDateTime(iso: string): { dateTime: string; timeZone: string } {
    return { dateTime: iso.replace(/Z$/, ''), timeZone: 'UTC' };
}

function mapMsTask(t: any): MsTask {
    return {
        id: t.id,
        title: t.title || '',
        notes: t.body?.content || undefined,
        status: t.status || 'notStarted',
        due: t.dueDateTime?.dateTime,
        completed: t.completedDateTime?.dateTime,
        updated: t.lastModifiedDateTime,
    };
}

export async function listMsTaskLists(accessToken: string): Promise<MsTaskList[]> {
    // Page through every list — Graph returns a bounded page plus an @odata.nextLink.
    const lists: MsTaskList[] = [];
    let next: string | undefined = '/todo/lists?$top=100';
    let pages = 0;
    while (next && pages++ < 50) {
        const data = await graphFetch(accessToken, next);
        for (const l of data.value || []) {
            lists.push({ id: l.id, title: l.displayName, wellknownListName: l.wellknownListName });
        }
        next = data['@odata.nextLink'];
    }
    return lists;
}

export async function getMsDefaultListId(accessToken: string): Promise<string> {
    const lists = await listMsTaskLists(accessToken);
    const def = lists.find((l) => l.wellknownListName === 'defaultList');
    if (def) return def.id;
    if (lists.length > 0) return lists[0].id;
    throw new Error('No Microsoft To Do task lists found for this account');
}

// Page through tasks in a list. Pass maxResults to cap the total; omit to return every task.
export async function listMsTasks(
    accessToken: string,
    listId: string,
    showCompleted = false,
    maxResults?: number
): Promise<MsTask[]> {
    const tasks: MsTask[] = [];
    const top = maxResults !== undefined ? Math.min(100, maxResults) : 100;
    let next: string | undefined =
        `/todo/lists/${encodeURIComponent(listId)}/tasks?$top=${top}` +
        (showCompleted ? '' : `&$filter=${encodeURIComponent("status ne 'completed'")}`);
    let pages = 0;
    while (next && pages++ < 50) {
        const data = await graphFetch(accessToken, next);
        for (const t of data.value || []) {
            tasks.push(mapMsTask(t));
        }
        if (maxResults !== undefined && tasks.length >= maxResults) break;
        next = data['@odata.nextLink'];
    }
    return maxResults !== undefined ? tasks.slice(0, maxResults) : tasks;
}

export async function createMsTask(
    accessToken: string,
    listId: string,
    task: { title: string; notes?: string; due?: string }
): Promise<MsTask> {
    const body: any = { title: task.title };
    if (task.notes) body.body = { content: task.notes, contentType: 'text' };
    if (task.due) body.dueDateTime = toGraphDateTime(task.due);
    const data = await graphFetch(accessToken, `/todo/lists/${encodeURIComponent(listId)}/tasks`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
    return mapMsTask(data);
}

export async function updateMsTask(
    accessToken: string,
    listId: string,
    taskId: string,
    updates: { title?: string; notes?: string; due?: string; status?: string }
): Promise<MsTask> {
    const body: any = {};
    if (updates.title !== undefined) body.title = updates.title;
    if (updates.notes !== undefined) body.body = { content: updates.notes, contentType: 'text' };
    if (updates.due !== undefined) body.dueDateTime = toGraphDateTime(updates.due);
    if (updates.status !== undefined) body.status = updates.status;
    const data = await graphFetch(
        accessToken,
        `/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: 'PATCH', body: JSON.stringify(body) }
    );
    return mapMsTask(data);
}

export async function deleteMsTask(accessToken: string, listId: string, taskId: string): Promise<void> {
    await graphFetch(accessToken, `/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
    });
}
