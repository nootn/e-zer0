// Microsoft Graph Mail API client

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0/me';

export interface EmailMessage {
    id: string;
    subject: string;
    from: string;
    to: string;
    date: string;
    snippet: string;
    body?: string;
    isRead: boolean;
}

async function graphFetch(accessToken: string, path: string, options?: RequestInit): Promise<any> {
    const res = await fetch(`${GRAPH_API_BASE}${path}`, {
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

    return res.json();
}

// Helper to encode Graph API IDs. Hotmail/Outlook IDs can end in '==' padding.
// Some Graph API infrastructure fails with ErrorInvalidIdMalformed if the ID is
// passed as %3D%3D because it attempts to Base64-decode before URL-decoding it.
// We also trim to prevent issues with trailing newlines from LLM arguments.
function encodeGraphId(id: string): string {
    return encodeURIComponent(id.trim()).replace(/%3D/gi, '=');
}

export async function listOutlookMessages(
    accessToken: string,
    maxResults = 10,
    unreadOnly = false
): Promise<EmailMessage[]> {
    const filter = unreadOnly ? '&$filter=isRead eq false' : '';
    const data = await graphFetch(
        accessToken,
        `/mailFolders/Inbox/messages?$top=${maxResults}${filter}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead&$orderby=receivedDateTime desc`
    );

    return (data.value || []).map((msg: any) => ({
        id: msg.id,
        subject: msg.subject || '',
        from: msg.from?.emailAddress?.address || '',
        to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).join(', '),
        date: msg.receivedDateTime || '',
        snippet: msg.bodyPreview || '',
        isRead: msg.isRead,
    }));
}

import type { GetEmailsOptions } from '../../mcp/tools';

export async function searchOutlookMessages(accessToken: string, options: GetEmailsOptions): Promise<EmailMessage[]> {
    let folder = (options.folder || 'inbox').toLowerCase();

    // Graph API well-known folder names
    const FOLDER_MAP: Record<string, string> = {
        archive: 'archive',
        inbox: 'inbox',
        spam: 'junkemail',
        junk: 'junkemail',
        trash: 'deleteditems',
        deleted: 'deleteditems',
        drafts: 'drafts',
        sent: 'sentitems',
    };

    let apiPath = `/mailFolders/inbox/messages`;
    let inferenceFilter = '';

    // Handle "other" or "focused" inbox pseudo-folders
    if (folder === 'other' || folder === 'focused') {
        const classification = folder === 'other' ? 'other' : 'focused';
        inferenceFilter = `inferenceClassification eq '${classification}'`;
        // Keep path as inbox because Focused/Other is just a view on the Inbox
    } else if (FOLDER_MAP[folder]) {
        apiPath = `/mailFolders/${FOLDER_MAP[folder]}/messages`;
    } else if (folder !== 'inbox' && folder !== 'all' && folder !== 'any') {
        // Assume custom folder
        const folders = await listOutlookFolders(accessToken);
        const customFolder = folders.find((f) => f.name.toLowerCase() === folder);
        if (customFolder) {
            apiPath = `/mailFolders/${customFolder.id}/messages`;
        }
    }

    // Strip double-quotes from user input — they conflict with Graph API's OData $search="..." outer
    // string delimiters and cause KQL syntax errors (e.g. subject:"Sydney Angels" inside $search="..."
    // makes the parser see an unterminated string).
    const sanitizeKql = (s: string) => s.replace(/"/g, '');

    const searchParts: string[] = [];
    if (options.is_read !== undefined) {
        searchParts.push(`isread:${options.is_read}`);
    }
    if (options.from) {
        searchParts.push(`from:${sanitizeKql(options.from)}`);
    }
    if (options.subject) {
        searchParts.push(`subject:${sanitizeKql(options.subject)}`);
    }
    if (options.after) {
        let afterVal = options.after;
        if (afterVal.includes('T')) {
            const ts = new Date(afterVal);
            if (!isNaN(ts.getTime())) afterVal = ts.toISOString();
        }
        searchParts.push(`received>=${afterVal}`);
    }
    if (options.before) {
        let beforeVal = options.before;
        if (beforeVal.includes('T')) {
            const ts = new Date(beforeVal);
            if (!isNaN(ts.getTime())) beforeVal = ts.toISOString();
        }
        searchParts.push(`received<=${beforeVal}`);
    }

    // Graph API queries
    const queryParams: string[] = [`$top=${options.count}`];
    queryParams.push(`$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead`);

    if (searchParts.length > 0) {
        const q = searchParts.join(' AND ');
        queryParams.push(`$search="${encodeURIComponent(q)}"`);
    } else {
        // Order by date if not searching
        queryParams.push(`$orderby=receivedDateTime desc`);
    }

    if (inferenceFilter) {
        // Note: You generally cannot combine $search and $filter on exchange queries the way you expect,
        // but $filter is required for Focused/Other. If a text search is also requested, Graph API might reject the combination.
        // As a workaround, we append the filter if there is no search, OR we use the $filter endpoint entirely if searching isn't used.
        // Actually, $search limits what can be used with $filter. We will prefer $filter if possible.
        // Because KQL (used in $search) doesn't support inferenceClassification natively, we must rely on $filter if 'other' is requested.
        queryParams.push(`$filter=${encodeURIComponent(inferenceFilter)}`);
    }

    const fullPath = `${apiPath}?${queryParams.join('&')}`;

    const data = await graphFetch(accessToken, fullPath);

    return (data.value || []).map((msg: any) => ({
        id: msg.id,
        subject: msg.subject || '',
        from: msg.from?.emailAddress?.address || '',
        to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).join(', '),
        date: msg.receivedDateTime || '',
        snippet: msg.bodyPreview || '',
        isRead: msg.isRead,
    }));
}

export async function getOutlookMessage(accessToken: string, messageId: string): Promise<EmailMessage> {
    const msg = await graphFetch(
        accessToken,
        `/messages/${encodeGraphId(messageId)}?$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead`
    );

    return {
        id: msg.id,
        subject: msg.subject || '',
        from: msg.from?.emailAddress?.address || '',
        to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).join(', '),
        date: msg.receivedDateTime || '',
        snippet: msg.bodyPreview || '',
        body: msg.body?.content || '',
        isRead: msg.isRead,
    };
}

export async function moveOutlookMessage(accessToken: string, messageId: string, folderId: string): Promise<void> {
    await graphFetch(accessToken, `/messages/${encodeGraphId(messageId)}/move`, {
        method: 'POST',
        body: JSON.stringify({ destinationId: folderId }),
    });
}

export async function deleteOutlookMessage(accessToken: string, messageId: string): Promise<void> {
    // Move to Deleted Items
    await graphFetch(accessToken, `/messages/${encodeGraphId(messageId)}/move`, {
        method: 'POST',
        body: JSON.stringify({ destinationId: 'deleteditems' }),
    });
}

export async function markOutlookMessageRead(accessToken: string, messageId: string, isRead: boolean): Promise<void> {
    await graphFetch(accessToken, `/messages/${encodeGraphId(messageId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ isRead }),
    });
}

// ── Folder Management ───────────────────────────────────

export interface OutlookFolder {
    id: string;
    name: string;
    parentFolderId?: string;
    path?: string;
}

export async function listOutlookFolders(accessToken: string): Promise<OutlookFolder[]> {
    const folders = await listAllOutlookFoldersFlat(accessToken);
    return withOutlookFolderPaths(folders);
}

/**
 * Recursively fetch all folders (top-level + all child folders).
 * Returns a flat list with parentFolderId so callers can reconstruct the tree.
 */
async function listAllOutlookFoldersFlat(accessToken: string): Promise<OutlookFolder[]> {
    const topLevel = await graphFetch(accessToken, '/mailFolders?$top=100&includeHiddenFolders=false');
    const result: OutlookFolder[] = [];

    async function fetchChildren(parentId: string) {
        const data = await graphFetch(accessToken, `/mailFolders/${encodeGraphId(parentId)}/childFolders?$top=100`);
        const rawChildren: any[] = data.value || [];
        const children: OutlookFolder[] = rawChildren.map((f: any) => ({
            id: f.id,
            name: f.displayName,
            parentFolderId: f.parentFolderId,
        }));
        result.push(...children);
        for (const raw of rawChildren) {
            if (raw.childFolderCount > 0) {
                await fetchChildren(raw.id);
            }
        }
    }

    for (const f of topLevel.value || []) {
        result.push({ id: f.id, name: f.displayName, parentFolderId: f.parentFolderId });
        if (f.childFolderCount > 0) {
            await fetchChildren(f.id);
        }
    }
    return result;
}

function splitOutlookFolderPath(folderPath: string): string[] {
    return folderPath
        .split(/[\\/]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function withOutlookFolderPaths(folders: OutlookFolder[]): OutlookFolder[] {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));

    const buildPath = (folder: OutlookFolder): string => {
        if (folder.path) return folder.path;

        const parts = [folder.name];
        let parentId = folder.parentFolderId;

        while (parentId) {
            const parent = byId.get(parentId);
            if (!parent) break;
            parts.unshift(parent.name);
            parentId = parent.parentFolderId;
        }

        folder.path = parts.join('/');
        return folder.path;
    };

    return folders.map((folder) => ({
        ...folder,
        path: buildPath(folder),
    }));
}

/**
 * Given a slash-separated path like "Work/Projects/Active", resolve or create
 * the full folder hierarchy in Outlook and return the leaf folder ID.
 *
 * Each segment is looked up as a child of the previous segment, and created
 * if it doesn't exist. Top-level segments are looked up/created under /mailFolders.
 */
async function resolveOrCreateFolderPath(accessToken: string, folderPath: string): Promise<string> {
    const segments = splitOutlookFolderPath(folderPath);
    if (segments.length === 0) throw new Error('Empty folder path');

    // Fetch all known folders once for efficient lookup
    const allFolders = await listAllOutlookFoldersFlat(accessToken);

    let parentId: string | null = null; // null = top-level
    let currentId: string | null = null;

    for (const segment of segments) {
        const existing = allFolders.find((f) => {
            if (f.name.toLowerCase() !== segment.toLowerCase()) return false;
            if (parentId === null) {
                // Top-level folders have parentFolderId pointing to the root structure,
                // which is not included in our fetched allFolders list.
                return !allFolders.some((p) => p.id === f.parentFolderId);
            }
            return f.parentFolderId === parentId;
        });

        if (existing) {
            currentId = existing.id;
        } else if (parentId === null) {
            // Create top-level folder
            const created = await graphFetch(accessToken, '/mailFolders', {
                method: 'POST',
                body: JSON.stringify({ displayName: segment }),
            });
            currentId = created.id;
            // Add to allFolders so subsequent segments can find it
            allFolders.push({ id: created.id, name: created.displayName, parentFolderId: undefined });
        } else {
            // Create child folder under parentId
            const created = await graphFetch(accessToken, `/mailFolders/${encodeGraphId(parentId)}/childFolders`, {
                method: 'POST',
                body: JSON.stringify({ displayName: segment }),
            });
            currentId = created.id;
            allFolders.push({ id: created.id, name: created.displayName, parentFolderId: parentId });
        }

        parentId = currentId;
    }

    return currentId!;
}

export async function resolveOutlookFolderId(
    accessToken: string,
    folderRef: string,
    createIfMissing = false
): Promise<string> {
    const normalizedRef = folderRef.trim();
    if (!normalizedRef) throw new Error('Empty folder reference');

    const folders = withOutlookFolderPaths(await listAllOutlookFoldersFlat(accessToken));

    const byId = folders.find((folder) => folder.id === normalizedRef);
    if (byId) return byId.id;

    const pathSegments = splitOutlookFolderPath(normalizedRef);
    if (pathSegments.length > 1) {
        const normalizedPath = pathSegments.join('/').toLowerCase();
        const byPath = folders.find((folder) => folder.path?.toLowerCase() === normalizedPath);
        if (byPath) return byPath.id;
        if (createIfMissing) return resolveOrCreateFolderPath(accessToken, normalizedRef);
        throw new Error(`Outlook folder not found: ${folderRef}`);
    }

    const byName = folders.find((folder) => folder.name.toLowerCase() === normalizedRef.toLowerCase());
    if (byName) return byName.id;
    if (createIfMissing) return resolveOrCreateFolderPath(accessToken, normalizedRef);

    throw new Error(`Outlook folder not found: ${folderRef}`);
}

export async function createOutlookFolder(accessToken: string, name: string): Promise<OutlookFolder> {
    const data = await graphFetch(accessToken, '/mailFolders', {
        method: 'POST',
        body: JSON.stringify({ displayName: name }),
    });
    return { id: data.id, name: data.displayName };
}

/**
 * Move email to a folder in Outlook.
 * Maps well-known folder names to Graph API well-known folder IDs.
 */
export async function moveOutlookToFolder(
    accessToken: string,
    messageId: string,
    folderName: string
): Promise<{ action: string; folder: string }> {
    // Graph API well-known folder names
    const FOLDER_MAP: Record<string, string> = {
        archive: 'archive',
        inbox: 'inbox',
        spam: 'junkemail',
        junk: 'junkemail',
        trash: 'deleteditems',
        deleted: 'deleteditems',
        drafts: 'drafts',
        sent: 'sentitems',
    };

    const normalized = folderName.toLowerCase().trim();
    const wellKnownId = FOLDER_MAP[normalized];

    if (wellKnownId) {
        await moveOutlookMessage(accessToken, messageId, wellKnownId);
        return { action: 'moved', folder: normalized };
    }

    const folderId = await resolveOutlookFolderId(accessToken, folderName, true);
    await moveOutlookMessage(accessToken, messageId, folderId);
    return { action: 'moved', folder: folderName };
}

// ── Rule Management ─────────────────────────────────────

export interface OutlookRuleConditions {
    senderContains?: string[];
    recipientContains?: string[];
    subjectContains?: string[];
    bodyContains?: string[];
    hasAttachments?: boolean;
}

export interface OutlookRuleActions {
    moveToFolder?: string; // Folder ID
    markAsRead?: boolean;
    delete?: boolean;
    forwardTo?: Record<string, any>[]; // emailAddress objects
}

export interface OutlookRule {
    id: string;
    displayName: string;
    sequence: number;
    isEnabled: boolean;
    conditions: OutlookRuleConditions;
    actions: OutlookRuleActions;
}

export async function listOutlookRules(accessToken: string): Promise<OutlookRule[]> {
    const data = await graphFetch(accessToken, '/mailFolders/inbox/messageRules');
    return data.value || [];
}

export async function createOutlookRule(
    accessToken: string,
    displayName: string,
    sequence: number,
    conditions: OutlookRuleConditions,
    actions: OutlookRuleActions
): Promise<OutlookRule> {
    return await graphFetch(accessToken, '/mailFolders/inbox/messageRules', {
        method: 'POST',
        body: JSON.stringify({
            displayName,
            sequence,
            isEnabled: true,
            conditions,
            actions,
        }),
    });
}

export async function updateOutlookRule(
    accessToken: string,
    ruleId: string,
    displayName?: string,
    conditions?: OutlookRuleConditions,
    actions?: OutlookRuleActions
): Promise<OutlookRule> {
    const body: any = {};
    if (displayName) body.displayName = displayName;
    if (conditions) body.conditions = conditions;
    if (actions) body.actions = actions;

    return await graphFetch(accessToken, `/mailFolders/inbox/messageRules/${encodeGraphId(ruleId)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function deleteOutlookRule(accessToken: string, ruleId: string): Promise<void> {
    await graphFetch(accessToken, `/mailFolders/inbox/messageRules/${encodeGraphId(ruleId)}`, {
        method: 'DELETE',
    });
}

export async function applyRuleToExistingOutlook(
    accessToken: string,
    conditions: any,
    actions: any,
    maxResults = 100
): Promise<void> {
    // 1. Build search query (KQL format for Graph API)
    const queryParts: string[] = [];
    if (conditions.from && conditions.from.length > 0) {
        queryParts.push(`from:(${conditions.from.join(' OR ')})`);
    }
    if (conditions.to && conditions.to.length > 0) {
        queryParts.push(`to:(${conditions.to.join(' OR ')})`);
    }
    if (conditions.subject && conditions.subject.length > 0) {
        queryParts.push(`subject:(${conditions.subject.join(' OR ')})`);
    }
    if (conditions.body && conditions.body.length > 0) {
        queryParts.push(`(${conditions.body.join(' OR ')})`);
    }

    const q = queryParts.join(' AND ');
    if (!q) return;

    // 2. Fetch messages
    const data = await graphFetch(
        accessToken,
        `/mailFolders/Inbox/messages?$search="${encodeURIComponent(q)}"&$select=id&$top=${maxResults}`
    );

    if (!data.value || data.value.length === 0) return;

    // 3. Iterate and apply actions
    for (const msg of data.value) {
        if (actions.markAsRead) {
            await markOutlookMessageRead(accessToken, msg.id, true);
        }
        if (actions.moveToFolder) {
            await moveOutlookMessage(accessToken, msg.id, actions.moveToFolder);
        }
        if (actions.delete) {
            await deleteOutlookMessage(accessToken, msg.id);
        }
    }
}
