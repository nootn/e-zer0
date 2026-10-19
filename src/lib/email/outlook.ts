// Microsoft Graph Mail API client
import type { DraftReplyResult } from '../../types';
import { assertEmailRequestAllowed } from './safety';
import { providerRequest } from '../provider-request';

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
    inferenceClassification?: 'focused' | 'other';
}

async function graphFetch(accessToken: string, path: string, options?: RequestInit): Promise<any> {
    assertEmailRequestAllowed(`${GRAPH_API_BASE}${path}`);
    const res = await providerRequest('microsoft_mail', `${GRAPH_API_BASE}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    if (!res.ok) {
        if (path.endsWith('/createReply')) throw new Error(`Graph API error (${res.status}): draft creation failed`);
        const err = await res.text();
        throw new Error(`Graph API error (${res.status}): ${err}`);
    }

    const body = await res.text();
    return body.trim() ? JSON.parse(body) : undefined;
}

// Helper to encode Graph API IDs. Hotmail/Outlook IDs can end in '==' padding.
// Some Graph API infrastructure fails with ErrorInvalidIdMalformed if the ID is
// passed as %3D%3D because it attempts to Base64-decode before URL-decoding it.
// We also trim to prevent issues with trailing newlines from LLM arguments.
function encodeGraphId(id: string): string {
    return encodeURIComponent(id.trim()).replace(/%3D/gi, '=');
}

function outlookContinuation(initial: URL, pageToken?: string): URL {
    const request = pageToken ? new URL(pageToken) : initial;
    // Graph nextLink uses OData key syntax and capitalised well-known folder aliases.
    const collection = (path: string) =>
        path
            .replace(/\/mailFolders\('([^']+)'\)/g, '/mailFolders/$1')
            .replace(
                /\/mailFolders\/(inbox|archive|junkemail|deleteditems|drafts|sentitems)(?=\/)/gi,
                (_, alias: string) => `/mailFolders/${alias.toLowerCase()}`
            );
    if (
        request.origin !== initial.origin ||
        collection(request.pathname) !== collection(initial.pathname) ||
        request.username ||
        request.password ||
        request.hash
    )
        throw new Error('Invalid Outlook page token');
    return request;
}

import type { GetEmailsOptions } from '../../mcp/tools';

export async function listOutlookMessages(
    accessToken: string,
    maxResults = 10,
    unreadOnly = false
): Promise<EmailMessage[]> {
    return searchOutlookMessages(accessToken, { count: maxResults, is_read: unreadOnly ? false : undefined });
}

export async function searchOutlookMessages(accessToken: string, options: GetEmailsOptions): Promise<EmailMessage[]> {
    return (await searchOutlookMessagePage(accessToken, options)).messages;
}

export async function searchOutlookMessagePage(
    accessToken: string,
    options: GetEmailsOptions,
    pageToken?: string
): Promise<{ messages: EmailMessage[]; next_page_token?: string; exhausted: boolean }> {
    const folder = (options.folder || 'inbox').toLowerCase();
    const classification = ['other', 'focused'].includes(folder) ? folder : undefined;
    const folders: Record<string, string> = {
        inbox: 'inbox',
        archive: 'archive',
        spam: 'junkemail',
        junk: 'junkemail',
        trash: 'deleteditems',
        deleted: 'deleteditems',
        drafts: 'drafts',
        sent: 'sentitems',
    };
    let apiPath = '/mailFolders/inbox/messages';
    if (folder === 'all' || folder === 'any') apiPath = '/messages';
    else if (folders[folder]) apiPath = `/mailFolders/${folders[folder]}/messages`;
    else if (!classification) {
        const found = (await listOutlookFolders(accessToken)).find(
            (f) => f.name.toLowerCase() === folder || f.id === options.folder
        );
        if (!found) throw new Error('Outlook folder not found');
        apiPath = `/mailFolders/${encodeGraphId(found.id)}/messages`;
    }
    const count = Math.max(1, Math.min(50, Math.floor(options.count)));
    if (!Number.isFinite(count)) throw new Error('Invalid email count');
    const date = (value?: string) => {
        if (!value) return undefined;
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) throw new Error('Invalid email date');
        return parsed.toISOString();
    };
    const after = date(options.after),
        before = date(options.before);
    if (after && before && after > before) throw new Error('Invalid email date range');
    const url = new URL(`${GRAPH_API_BASE}${apiPath}`);
    url.searchParams.set('$top', String(count));
    url.searchParams.set(
        '$select',
        'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,inferenceClassification'
    );
    if (options.from || options.subject) {
        const terms = [];
        if (options.from) terms.push(`from:${options.from.replace(/"/g, '')}`);
        if (options.subject) terms.push(`subject:${options.subject.replace(/"/g, '')}`);
        if (after) terms.push(`received>=${after}`);
        if (before) terms.push(`received<=${before}`);
        url.searchParams.set('$search', `"${terms.join(' AND ')}"`);
        // Graph search cannot combine classification/read filters; validate those on each page.
    } else {
        // Graph requires the ordered property first in the filter, even for classification-only reads.
        const filters = [`receivedDateTime ge ${after || '0001-01-01T00:00:00Z'}`];
        if (before) filters.push(`receivedDateTime le ${before}`);
        if (classification) filters.push(`inferenceClassification eq '${classification}'`);
        if (options.is_read !== undefined) filters.push(`isRead eq ${options.is_read}`);
        url.searchParams.set('$filter', filters.join(' and '));
        url.searchParams.set('$orderby', 'receivedDateTime desc');
    }
    const request = outlookContinuation(url, pageToken);
    const data = await graphFetch(accessToken, request.toString().slice(GRAPH_API_BASE.length));
    if (!Array.isArray(data?.value)) throw new Error('Invalid Outlook message page');
    const messages: EmailMessage[] = data.value
        .filter(
            (msg: any) =>
                (!classification || msg.inferenceClassification === classification) &&
                (options.is_read === undefined || msg.isRead === options.is_read) &&
                (!after || Date.parse(msg.receivedDateTime) >= Date.parse(after)) &&
                (!before || Date.parse(msg.receivedDateTime) <= Date.parse(before))
        )
        .slice(0, count)
        .map((msg: any) => ({
            id: msg.id,
            subject: msg.subject || '',
            from: msg.from?.emailAddress?.address || '',
            to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).join(', '),
            date: msg.receivedDateTime || '',
            snippet: msg.bodyPreview || '',
            isRead: msg.isRead,
            inferenceClassification: msg.inferenceClassification,
        }));
    return { messages, next_page_token: data?.['@odata.nextLink'], exhausted: !data?.['@odata.nextLink'] };
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

export async function listOutlookMessagePage(
    accessToken: string,
    count = 50,
    pageToken?: string
): Promise<{ message_ids: string[]; next_page_token?: string }> {
    const initial = new URL(`${GRAPH_API_BASE}/mailFolders/inbox/messages`);
    initial.searchParams.set('$top', String(count));
    initial.searchParams.set('$select', 'id');
    const url = outlookContinuation(initial, pageToken);
    const data = await graphFetch(accessToken, url.toString().slice(GRAPH_API_BASE.length));
    return {
        message_ids: (data?.value || []).map((m: { id: string }) => m.id),
        next_page_token: data?.['@odata.nextLink'],
    };
}

export async function moveOutlookMessage(accessToken: string, messageId: string, folderId: string): Promise<string> {
    const moved = await graphFetch(accessToken, `/messages/${encodeGraphId(messageId)}/move`, {
        method: 'POST',
        body: JSON.stringify({ destinationId: folderId }),
    });
    if (!moved.id) throw new Error('Microsoft did not return the moved message ID');
    return moved.id;
}

export async function draftOutlookReply(
    accessToken: string,
    messageId: string,
    body: string
): Promise<DraftReplyResult> {
    const draft = await graphFetch(accessToken, `/messages/${encodeGraphId(messageId)}/createReply`, {
        method: 'POST',
        body: JSON.stringify({ message: { body: { contentType: 'Text', content: body } } }),
    });
    if (!draft.id || draft.isDraft !== true) throw new Error('Microsoft did not return a reply draft');
    return { draft_id: draft.id, message_id: draft.id };
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
): Promise<{ action: string; folder: string; message_id: string }> {
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
        const movedId = await moveOutlookMessage(accessToken, messageId, wellKnownId);
        return { action: 'moved', folder: normalized, message_id: movedId };
    }

    const folderId = await resolveOutlookFolderId(accessToken, folderName, true);
    const movedId = await moveOutlookMessage(accessToken, messageId, folderId);
    return { action: 'moved', folder: folderName, message_id: movedId };
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
    return Array.isArray(data?.value) ? data.value : [];
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

function quoteKqlSearchValue(value: string): string {
    if (/[\\"\x00-\x1f\x7f]/.test(value)) {
        throw new Error('Retroactive rule conditions cannot contain quotes, backslashes, or control characters');
    }
    return `"${value}"`;
}

function buildKqlSearchClause(field: string | undefined, values?: string[]): string | undefined {
    const quotedValues = values
        ?.map((value) => value.trim())
        .filter(Boolean)
        .map(quoteKqlSearchValue);
    if (!quotedValues || quotedValues.length === 0) return undefined;

    const terms = quotedValues.map((value) => (field ? `${field}:${value}` : value));
    return terms.length === 1 ? terms[0] : `(${terms.join(' OR ')})`;
}

export async function applyRuleToExistingOutlook(
    accessToken: string,
    conditions: any,
    actions: any,
    maxResults = 100
): Promise<void> {
    // 1. Build a KQL search query with all condition values quoted as literals.
    const queryParts = [
        buildKqlSearchClause('from', conditions.from),
        buildKqlSearchClause('to', conditions.to),
        buildKqlSearchClause('subject', conditions.subject),
        buildKqlSearchClause(undefined, conditions.body),
    ].filter((part): part is string => Boolean(part));

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
