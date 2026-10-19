// Gmail API client
import type { DraftReplyResult, GmailMessageMetadata, GmailReplyMetadata, GmailMimePart } from '../../types';
import { assertEmailRequestAllowed } from './safety';
import { providerRequest } from '../provider-request';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface EmailMessage {
    id: string;
    threadId: string;
    subject: string;
    from: string;
    to: string;
    date: string;
    snippet: string;
    body?: string;
    body_complete?: boolean;
    is_calendar?: boolean;
    labels: string[];
}

async function gmailFetch(accessToken: string, path: string, options?: RequestInit): Promise<any> {
    assertEmailRequestAllowed(`${GMAIL_API_BASE}${path}`);
    const res = await providerRequest('gmail', `${GMAIL_API_BASE}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    if (!res.ok) {
        if (path === '/drafts') throw new Error(`Gmail API error (${res.status}): draft creation failed`);
        const err = await res.text();
        throw new Error(`Gmail API error (${res.status}): ${err}`);
    }

    // Successful deletes and bulk updates may have no response body.
    const body = await res.text();
    return body.trim() ? JSON.parse(body) : undefined;
}

function encodeGmailPathSegment(segment: string): string {
    return encodeURIComponent(segment);
}

export async function draftGmailReply(
    accessToken: string,
    messageId: string,
    body: string,
    sender: string
): Promise<DraftReplyResult> {
    if (!sender || /[\r\n\0]/.test(sender)) throw new Error('Invalid reply sender');
    const original: GmailReplyMetadata = await gmailFetch(
        accessToken,
        `/messages/${encodeGmailPathSegment(messageId)}?format=metadata`
    );
    const headers: { name: string; value: string }[] = original.payload?.headers || [];
    const header = (name: string): string => {
        const value = decodeHeader(headers, name);
        if (/[\r\n\0]/.test(value)) throw new Error('Unsafe email reply header');
        return value;
    };
    const recipient = header('Reply-To') || header('From');
    const parentId = header('Message-ID');
    if (!recipient || !parentId || !original.threadId) throw new Error('Original message lacks reply metadata');
    const base64 = (value: string): string =>
        btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''));
    const subject = header('Subject');
    const encodedSubject = /[^\x00-\x7F]/.test(subject) ? `=?UTF-8?B?${base64(subject)}?=` : subject;
    const mime = [
        `From: ${sender}`,
        `To: ${recipient}`,
        `Date: ${new Date().toUTCString()}`,
        `Subject: ${encodedSubject}`,
        `In-Reply-To: ${parentId}`,
        `References: ${[header('References'), parentId].filter(Boolean).join(' ')}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        base64(body)
            .match(/.{1,76}/g)
            ?.join('\r\n') || '',
    ].join('\r\n');
    const draft = await gmailFetch(accessToken, '/drafts', {
        method: 'POST',
        body: JSON.stringify({
            message: {
                threadId: original.threadId,
                raw: base64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
            },
        }),
    });
    if (!draft.id || !draft.message?.id) throw new Error('Gmail did not return a draft ID');
    return { draft_id: draft.id, message_id: draft.message.id };
}

function decodeHeader(headers: any[], name: string): string {
    const h = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
    return h?.value || '';
}

async function getGmailMetadata(accessToken: string, entries: { id: string }[]): Promise<EmailMessage[]> {
    const messages: EmailMessage[] = [];
    // Native Gmail batches stay below Workers Free's 50-fetch ceiling.
    // Sequential groups of ten avoid a burst of 50 provider reads.
    for (let i = 0; i < entries.length; i += 10) {
        const batch = entries.slice(i, i + 10);
        const boundary = `batch_${crypto.randomUUID()}`;
        const parts = batch.map((msg) => {
            const path = `/gmail/v1/users/me/messages/${encodeGmailPathSegment(msg.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`;
            assertEmailRequestAllowed(`https://gmail.googleapis.com${path}`);
            return `--${boundary}\r\nContent-Type: application/http\r\n\r\nGET ${path} HTTP/1.1\r\n\r\n`;
        });
        const res = await providerRequest('gmail_batch', 'https://gmail.googleapis.com/batch/gmail/v1', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': `multipart/mixed; boundary=${boundary}`,
            },
            body: parts.join('') + `--${boundary}--\r\n`,
        });
        if (!res.ok) throw new Error(`Gmail API error (${res.status}): metadata batch failed`);

        const contentType = res.headers.get('Content-Type') || '';
        const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
        const responseBoundary = match?.[1] || match?.[2];
        if (!/^multipart\/mixed\b/i.test(contentType) || !responseBoundary || /[\r\n]/.test(responseBoundary)) {
            throw new Error('Invalid Gmail metadata batch boundary');
        }
        const responses = `\r\n${await res.text()}`.split(`\r\n--${responseBoundary}`);
        if (responses.length !== batch.length + 2 || responses.at(-1)?.trim() !== '--') {
            throw new Error('Incomplete Gmail metadata batch response');
        }
        for (let j = 0; j < batch.length; j++) {
            const part = responses[j + 1];
            const outerEnd = part.indexOf('\r\n\r\n');
            const http = part.slice(outerEnd + 4);
            const status = /^HTTP\/1\.[01] (\d{3})\b/.exec(http)?.[1];
            const headersEnd = http.indexOf('\r\n\r\n');
            if (outerEnd < 0 || !status || headersEnd < 0) throw new Error('Invalid Gmail metadata batch part');
            if (Number(status) < 200 || Number(status) >= 300) {
                throw new Error(`Gmail API error (${status}): metadata read failed`);
            }
            const full: GmailMessageMetadata = JSON.parse(http.slice(headersEnd + 4));
            if (full.id !== batch[j].id || !Array.isArray(full.payload?.headers)) {
                throw new Error('Invalid Gmail metadata batch message');
            }
            messages.push({
                id: full.id,
                threadId: full.threadId,
                subject: decodeHeader(full.payload.headers, 'Subject'),
                from: decodeHeader(full.payload.headers, 'From'),
                to: decodeHeader(full.payload.headers, 'To'),
                date: decodeHeader(full.payload.headers, 'Date'),
                snippet: full.snippet || '',
                labels: full.labelIds || [],
            });
        }
    }
    return messages;
}

export async function listGmailMessages(
    accessToken: string,
    maxResults = 10,
    unreadOnly = false
): Promise<EmailMessage[]> {
    const query = unreadOnly ? '&q=is:unread' : '';
    const list = await gmailFetch(accessToken, `/messages?maxResults=${maxResults}&labelIds=INBOX${query}`);

    if (!list.messages || list.messages.length === 0) return [];

    return getGmailMetadata(accessToken, list.messages);
}

import type { GetEmailsOptions } from '../../mcp/tools';

export async function searchGmailMessages(accessToken: string, options: GetEmailsOptions): Promise<EmailMessage[]> {
    return (await searchGmailMessagePage(accessToken, options)).messages;
}

export async function searchGmailMessagePage(accessToken: string, options: GetEmailsOptions, pageToken?: string) {
    const queryParts: string[] = [];

    // Folder mapping
    const folder = (options.folder || 'inbox').toLowerCase();
    if (folder !== 'all' && folder !== 'any') {
        // Handle common custom names that might be categories
        const isCategory = ['promotions', 'social', 'updates', 'forums'].includes(folder);
        if (isCategory) {
            queryParts.push(`category:${folder}`);
        } else {
            queryParts.push(`label:${folder}`);
        }
    }

    if (options.is_read !== undefined) {
        queryParts.push(options.is_read ? 'is:read' : 'is:unread');
    }
    if (options.from) {
        queryParts.push(`from:(${options.from})`);
    }
    if (options.subject) {
        queryParts.push(`subject:(${options.subject})`);
    }
    if (options.after) {
        let afterVal = options.after;
        if (afterVal.includes('T')) {
            const ts = new Date(afterVal);
            if (!isNaN(ts.getTime())) afterVal = Math.floor(ts.getTime() / 1000).toString();
        }
        queryParts.push(`after:${afterVal}`);
    }
    if (options.before) {
        let beforeVal = options.before;
        if (beforeVal.includes('T')) {
            const ts = new Date(beforeVal);
            if (!isNaN(ts.getTime())) beforeVal = Math.floor(ts.getTime() / 1000).toString();
        }
        queryParts.push(`before:${beforeVal}`);
    }

    const q = queryParts.join(' ');
    // Always fetch INBOX if nothing else is specified and it's empty, but we already default folder to inbox

    const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const list = await gmailFetch(
        accessToken,
        `/messages?maxResults=${options.count}&q=${encodeURIComponent(q)}${page}`
    );
    return {
        messages: list.messages?.length ? await getGmailMetadata(accessToken, list.messages) : [],
        next_page_token: list.nextPageToken as string | undefined,
        exhausted: !list.nextPageToken,
    };
}

export async function getGmailMessage(accessToken: string, messageId: string): Promise<EmailMessage> {
    const full = await gmailFetch(accessToken, `/messages/${encodeGmailPathSegment(messageId)}?format=full`);
    const headers = full.payload?.headers || [];
    const texts: string[] = [];
    let complete = true;
    let calendar = false;
    let attachmentReads = 0;
    let visited = 0;
    const walk = async (part: GmailMimePart): Promise<void> => {
        if (++visited > 200) {
            complete = false;
            return;
        }
        if (/^text\/calendar(?:;|$)/i.test(part.mimeType || '') || /\.(ics|ical)$/i.test(part.filename || ''))
            calendar = true;
        if (/^text\/(plain|html)$/i.test(part.mimeType || '')) {
            let data = part.body?.data;
            if (!data && part.body?.attachmentId) {
                if (attachmentReads++ >= 4) {
                    complete = false;
                    return;
                }
                data = (
                    await gmailFetch(
                        accessToken,
                        `/messages/${encodeGmailPathSegment(messageId)}/attachments/${encodeGmailPathSegment(part.body.attachmentId)}`
                    )
                )?.data;
            }
            if (data) {
                const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
                const charset =
                    /charset=["']?([^;"'\s]+)/i.exec(decodeHeader(part.headers || [], 'Content-Type'))?.[1] || 'utf-8';
                const decoded = new TextDecoder(charset, { fatal: true, ignoreBOM: false }).decode(
                    Uint8Array.from(binary, (c) => c.charCodeAt(0))
                );
                texts.push(decoded);
            } else if ((part.body?.size || 0) > 0) complete = false;
        } else if (
            (!part.filename || /^\s*inline(?:;|$)/i.test(decodeHeader(part.headers || [], 'Content-Disposition'))) &&
            (part.body?.data || part.body?.attachmentId || (part.body?.size || 0) > 0) &&
            !part.parts?.length &&
            !/^text\/calendar(?:;|$)/i.test(part.mimeType || '')
        ) {
            complete = false;
        }
        for (const child of part.parts || []) await walk(child);
    };
    if (full.payload) await walk(full.payload);
    else complete = false;
    const body = texts.join('\n');
    if (/BEGIN:VCALENDAR|Content-Class:\s*urn:content-classes:calendarmessage/i.test(body)) calendar = true;
    if (
        /text\/calendar|calendarmessage/i.test(
            decodeHeader(headers, 'Content-Type') + ' ' + decodeHeader(headers, 'Content-Class')
        )
    )
        calendar = true;

    return {
        id: full.id,
        threadId: full.threadId,
        subject: decodeHeader(headers, 'Subject'),
        from: decodeHeader(headers, 'From'),
        to: decodeHeader(headers, 'To'),
        date: decodeHeader(headers, 'Date'),
        snippet: full.snippet || '',
        body,
        body_complete: complete,
        is_calendar: calendar,
        labels: full.labelIds || [],
    };
}

export async function modifyGmailMessage(
    accessToken: string,
    messageId: string,
    addLabels: string[] = [],
    removeLabels: string[] = []
): Promise<void> {
    await gmailFetch(accessToken, `/messages/${encodeGmailPathSegment(messageId)}/modify`, {
        method: 'POST',
        body: JSON.stringify({ addLabelIds: addLabels, removeLabelIds: removeLabels }),
    });
}

export async function getGmailMessageLabels(accessToken: string, messageId: string): Promise<string[]> {
    const data = await gmailFetch(accessToken, `/messages/${encodeGmailPathSegment(messageId)}?format=minimal`);
    if (!data?.id) throw new Error('Missing Gmail message label state');
    return data.labelIds || [];
}

export async function deleteGmailMessage(accessToken: string, messageId: string): Promise<void> {
    await gmailFetch(accessToken, `/messages/${encodeGmailPathSegment(messageId)}/trash`, { method: 'POST' });
}

// ── Label Management ────────────────────────────────────

export interface GmailLabel {
    id: string;
    name: string;
    type: 'system' | 'user';
}

export async function listGmailLabels(accessToken: string): Promise<GmailLabel[]> {
    const data = await gmailFetch(accessToken, '/labels');
    return (data?.labels || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        type: l.type === 'system' ? 'system' : 'user',
    }));
}

export async function createGmailLabel(accessToken: string, name: string): Promise<GmailLabel> {
    const existing = (await listGmailLabels(accessToken)).find(
        (label) => label.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return existing;
    try {
        const data = await gmailFetch(accessToken, '/labels', {
            method: 'POST',
            body: JSON.stringify({
                name,
                labelListVisibility: 'labelShow',
                messageListVisibility: 'show',
            }),
        });
        if (!data?.id) throw new Error('Uncertain Gmail label creation');
        return { id: data.id, name: data.name, type: 'user' };
    } catch (error) {
        try {
            const reconciled = (await listGmailLabels(accessToken)).find(
                (label) => label.name.toLowerCase() === name.toLowerCase()
            );
            if (reconciled) return reconciled;
        } catch {
            /* An inventory failure must not replace the original uncertain write. */
        }
        throw error;
    }
}

function normalizeGmailLabelRef(labelRef: string): string {
    return labelRef
        .split(/[\\/]+/)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .join('/');
}

export async function resolveGmailLabelId(
    accessToken: string,
    labelRef: string,
    createIfMissing = false
): Promise<string> {
    const normalizedRef = normalizeGmailLabelRef(labelRef);
    if (!normalizedRef) throw new Error('Empty label reference');

    const labels = await listGmailLabels(accessToken);

    const byId = labels.find((label) => label.id === normalizedRef);
    if (byId) return byId.id;

    const byName = labels.find((label) => label.name.toLowerCase() === normalizedRef.toLowerCase());
    if (byName) return byName.id;

    if (!createIfMissing) {
        throw new Error(`Gmail label not found: ${labelRef}`);
    }

    const created = await createGmailLabel(accessToken, normalizedRef);
    return created.id;
}

/**
 * Move email to a "folder" in Gmail by applying a label.
 * Maps well-known folder names to Gmail system labels.
 */
export async function moveGmailToFolder(
    accessToken: string,
    messageId: string,
    folderName: string,
    sourceLabel?: string
): Promise<{ action: string; folder: string }> {
    // Map common folder names to Gmail label IDs
    const FOLDER_MAP: Record<string, { add: string[]; remove: string[] }> = {
        archive: { add: [], remove: ['INBOX'] },
        inbox: { add: ['INBOX'], remove: [] },
        spam: { add: ['SPAM'], remove: ['INBOX'] },
        trash: { add: ['TRASH'], remove: ['INBOX'] },
        starred: { add: ['STARRED'], remove: [] },
        important: { add: ['IMPORTANT'], remove: [] },
        promotions: { add: ['CATEGORY_PROMOTIONS'], remove: ['INBOX'] },
        social: { add: ['CATEGORY_SOCIAL'], remove: ['INBOX'] },
        updates: { add: ['CATEGORY_UPDATES'], remove: ['INBOX'] },
        forums: { add: ['CATEGORY_FORUMS'], remove: ['INBOX'] },
    };

    const normalized = folderName.toLowerCase().trim();
    const mapping = FOLDER_MAP[normalized];
    const sourceId = sourceLabel ? await resolveGmailLabelId(accessToken, sourceLabel) : undefined;
    const removals = (add: string[], remove: string[]): string[] =>
        [...new Set([...remove, ...(sourceId ? [sourceId] : [])])].filter((id) => !add.includes(id));

    if (mapping) {
        await modifyGmailMessage(accessToken, messageId, mapping.add, removals(mapping.add, mapping.remove));
        return { action: 'moved', folder: normalized };
    }

    const labelId = await resolveGmailLabelId(accessToken, folderName, true);
    await modifyGmailMessage(accessToken, messageId, [labelId], removals([labelId], ['INBOX']));
    return { action: 'moved', folder: normalizeGmailLabelRef(folderName) };
}

// ── Filter (Rule) Management ────────────────────────────

export interface GmailFilterCriteria {
    from?: string;
    to?: string;
    subject?: string;
    query?: string;
    negatedQuery?: string;
    hasAttachment?: boolean;
    excludeChats?: boolean;
    size?: number;
    sizeComparison?: 'unspecified' | 'larger' | 'smaller';
}

export interface GmailFilterAction {
    addLabelIds?: string[];
    removeLabelIds?: string[];
    forward?: string;
}

export interface GmailFilter {
    id: string;
    criteria: GmailFilterCriteria;
    action: GmailFilterAction;
}

export async function listGmailFilters(accessToken: string, requireInventory = false): Promise<GmailFilter[]> {
    const data = await gmailFetch(accessToken, '/settings/filters');
    if (
        requireInventory &&
        (!data || typeof data !== 'object' || (data.filter !== undefined && !Array.isArray(data.filter)))
    )
        throw new Error('Gmail filter inventory unavailable; cannot safely reconcile writes');
    return Array.isArray(data?.filter) ? data.filter : [];
}

export async function createGmailFilter(
    accessToken: string,
    criteria: GmailFilterCriteria,
    action: GmailFilterAction
): Promise<GmailFilter> {
    const existing = await findGmailFilter(accessToken, criteria, action);
    if (existing) return existing;
    try {
        const created = await gmailFetch(accessToken, '/settings/filters', {
            method: 'POST',
            body: JSON.stringify({ criteria, action }),
        });
        if (!created?.id) throw new Error('Uncertain Gmail filter creation');
        return created;
    } catch (error) {
        try {
            const reconciled = await findGmailFilter(accessToken, criteria, action);
            if (reconciled) return reconciled;
        } catch {
            /* Preserve the POST outcome, not a later reconciliation GET failure. */
        }
        throw error;
    }
}

export async function findGmailFilter(
    accessToken: string,
    criteria: GmailFilterCriteria,
    action: GmailFilterAction
): Promise<GmailFilter | undefined> {
    const canonical = (value: unknown): string =>
        JSON.stringify(value, (_, item) => {
            if (Array.isArray(item)) return [...item].sort();
            if (item && typeof item === 'object')
                return Object.fromEntries(
                    Object.entries(item)
                        .filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))
                        .sort(([a], [b]) => a.localeCompare(b))
                );
            return item;
        });
    return (await listGmailFilters(accessToken, true)).find(
        (filter) => canonical(filter.criteria) === canonical(criteria) && canonical(filter.action) === canonical(action)
    );
}

export async function deleteGmailFilter(accessToken: string, filterId: string): Promise<void> {
    try {
        await gmailFetch(accessToken, `/settings/filters/${encodeGmailPathSegment(filterId)}`, {
            method: 'DELETE',
        });
    } catch (error) {
        if (error instanceof Error && /Gmail API error \((400|401|403|429)\)/.test(error.message)) throw error;
        try {
            if (!(await listGmailFilters(accessToken, true)).some((filter) => filter.id === filterId)) return;
        } catch {
            /* Preserve the original uncertain failure. */
        }
        throw error;
    }
}

function quoteGmailSearchValue(value: string): string {
    if (/[\\"\x00-\x1f\x7f]/.test(value)) {
        throw new Error('Retroactive rule conditions cannot contain quotes, backslashes, or control characters');
    }
    return `"${value}"`;
}

export function buildGmailSearchClause(field: string | undefined, values?: string[]): string | undefined {
    const quotedValues = values
        ?.map((value) => value.trim())
        .filter(Boolean)
        .map(quoteGmailSearchValue);
    if (!quotedValues || quotedValues.length === 0) return undefined;

    const terms = quotedValues.map((value) => (field ? `${field}:${value}` : value));
    return terms.length === 1 ? terms[0] : `{${terms.join(' ')}}`;
}

export async function listGmailMessagePage(
    accessToken: string,
    query: string,
    count = 5,
    pageToken?: string
): Promise<{ message_ids: string[]; next_page_token?: string }> {
    const params = new URLSearchParams({ q: query, maxResults: String(count) });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await gmailFetch(accessToken, `/messages?${params}`);
    return {
        message_ids: (data?.messages || []).map((m: { id: string }) => m.id),
        next_page_token: data?.nextPageToken,
    };
}

export async function applyRuleToExistingGmail(
    accessToken: string,
    conditions: any,
    actions: any,
    maxResults = 500
): Promise<void> {
    // 1. Build a Gmail search query with all condition values quoted as literals.
    const queryParts = [
        buildGmailSearchClause('from', conditions.from),
        buildGmailSearchClause('to', conditions.to),
        buildGmailSearchClause('subject', conditions.subject),
        buildGmailSearchClause(undefined, conditions.body),
    ].filter((part): part is string => Boolean(part));

    const q = queryParts.join(' ');
    if (!q) return;

    // 2. Fetch messages
    const listRes = await gmailFetch(accessToken, `/messages?q=${encodeURIComponent(q)}&maxResults=${maxResults}`);
    if (!listRes.messages || listRes.messages.length === 0) return;

    const messageIds = listRes.messages.map((m: any) => m.id);

    // 3. Build action lists
    const addLabelIds: string[] = [];
    const removeLabelIds: string[] = [];

    if (actions.markAsRead) {
        removeLabelIds.push('UNREAD');
    }
    if (actions.moveToFolder) {
        addLabelIds.push(actions.moveToFolder);
        removeLabelIds.push('INBOX');
    }
    if (actions.delete) {
        addLabelIds.push('TRASH');
    }

    if (addLabelIds.length === 0 && removeLabelIds.length === 0) return;

    // 4. Batch modify
    await gmailFetch(accessToken, '/messages/batchModify', {
        method: 'POST',
        body: JSON.stringify({
            ids: messageIds,
            addLabelIds,
            removeLabelIds,
        }),
    });
}
