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

    const searchParts: string[] = [];
    if (options.is_read !== undefined) {
        searchParts.push(`isread:${options.is_read}`);
    }
    if (options.from) {
        searchParts.push(`from:"${options.from}"`);
    }
    if (options.subject) {
        searchParts.push(`subject:"${options.subject}"`);
    }
    if (options.after) {
        // KQL expects dates
        searchParts.push(`received>="${options.after}"`);
    }
    if (options.before) {
        searchParts.push(`received<"${options.before}"`);
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
        `/messages/${messageId}?$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead`
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
    await graphFetch(accessToken, `/messages/${messageId}/move`, {
        method: 'POST',
        body: JSON.stringify({ destinationId: folderId }),
    });
}

export async function deleteOutlookMessage(accessToken: string, messageId: string): Promise<void> {
    // Move to Deleted Items
    await graphFetch(accessToken, `/messages/${messageId}/move`, {
        method: 'POST',
        body: JSON.stringify({ destinationId: 'deleteditems' }),
    });
}

export async function markOutlookMessageRead(accessToken: string, messageId: string, isRead: boolean): Promise<void> {
    await graphFetch(accessToken, `/messages/${messageId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isRead }),
    });
}

// ── Folder Management ───────────────────────────────────

export interface OutlookFolder {
    id: string;
    name: string;
    parentFolderId?: string;
}

export async function listOutlookFolders(accessToken: string): Promise<OutlookFolder[]> {
    const data = await graphFetch(accessToken, '/mailFolders?$top=100');
    return (data.value || []).map((f: any) => ({
        id: f.id,
        name: f.displayName,
        parentFolderId: f.parentFolderId,
    }));
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

    // Custom folder — find or create it
    const folders = await listOutlookFolders(accessToken);
    let folder = folders.find((f) => f.name.toLowerCase() === normalized);
    if (!folder) {
        folder = await createOutlookFolder(accessToken, folderName);
    }
    await moveOutlookMessage(accessToken, messageId, folder.id);
    return { action: 'moved', folder: folder.name };
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

    return await graphFetch(accessToken, `/mailFolders/inbox/messageRules/${ruleId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

export async function deleteOutlookRule(accessToken: string, ruleId: string): Promise<void> {
    await graphFetch(accessToken, `/mailFolders/inbox/messageRules/${ruleId}`, {
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
