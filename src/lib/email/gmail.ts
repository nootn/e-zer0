// Gmail API client

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
    labels: string[];
}

async function gmailFetch(accessToken: string, path: string, options?: RequestInit): Promise<any> {
    const res = await fetch(`${GMAIL_API_BASE}${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gmail API error (${res.status}): ${err}`);
    }

    return res.json();
}

function decodeHeader(headers: any[], name: string): string {
    const h = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
    return h?.value || '';
}

export async function listGmailMessages(accessToken: string, maxResults = 10): Promise<EmailMessage[]> {
    const list = await gmailFetch(accessToken, `/messages?maxResults=${maxResults}&labelIds=INBOX`);

    if (!list.messages || list.messages.length === 0) return [];

    const messages: EmailMessage[] = [];
    for (const msg of list.messages) {
        const full = await gmailFetch(
            accessToken,
            `/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`
        );
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

    return messages;
}

export async function getGmailMessage(accessToken: string, messageId: string): Promise<EmailMessage> {
    const full = await gmailFetch(accessToken, `/messages/${messageId}?format=full`);
    const headers = full.payload.headers;

    let body = '';
    if (full.payload.body?.data) {
        body = atob(full.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    } else if (full.payload.parts) {
        const textPart = full.payload.parts.find((p: any) => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
            body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        }
    }

    return {
        id: full.id,
        threadId: full.threadId,
        subject: decodeHeader(headers, 'Subject'),
        from: decodeHeader(headers, 'From'),
        to: decodeHeader(headers, 'To'),
        date: decodeHeader(headers, 'Date'),
        snippet: full.snippet || '',
        body,
        labels: full.labelIds || [],
    };
}

export async function modifyGmailMessage(
    accessToken: string,
    messageId: string,
    addLabels: string[] = [],
    removeLabels: string[] = []
): Promise<void> {
    await gmailFetch(accessToken, `/messages/${messageId}/modify`, {
        method: 'POST',
        body: JSON.stringify({ addLabelIds: addLabels, removeLabelIds: removeLabels }),
    });
}

export async function deleteGmailMessage(accessToken: string, messageId: string): Promise<void> {
    await gmailFetch(accessToken, `/messages/${messageId}/trash`, { method: 'POST' });
}

// ── Label Management ────────────────────────────────────

export interface GmailLabel {
    id: string;
    name: string;
    type: 'system' | 'user';
}

export async function listGmailLabels(accessToken: string): Promise<GmailLabel[]> {
    const data = await gmailFetch(accessToken, '/labels');
    return (data.labels || []).map((l: any) => ({
        id: l.id,
        name: l.name,
        type: l.type === 'system' ? 'system' : 'user',
    }));
}

export async function createGmailLabel(accessToken: string, name: string): Promise<GmailLabel> {
    const data = await gmailFetch(accessToken, '/labels', {
        method: 'POST',
        body: JSON.stringify({
            name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
        }),
    });
    return { id: data.id, name: data.name, type: 'user' };
}

/**
 * Move email to a "folder" in Gmail by applying a label.
 * Maps well-known folder names to Gmail system labels.
 */
export async function moveGmailToFolder(
    accessToken: string,
    messageId: string,
    folderName: string
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

    if (mapping) {
        await modifyGmailMessage(accessToken, messageId, mapping.add, mapping.remove);
        return { action: 'moved', folder: normalized };
    }

    // Custom label — find or create it
    const labels = await listGmailLabels(accessToken);
    let label = labels.find((l) => l.name.toLowerCase() === normalized);
    if (!label) {
        label = await createGmailLabel(accessToken, folderName);
    }
    await modifyGmailMessage(accessToken, messageId, [label.id], ['INBOX']);
    return { action: 'moved', folder: label.name };
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

export async function listGmailFilters(accessToken: string): Promise<GmailFilter[]> {
    const data = await gmailFetch(accessToken, '/settings/filters');
    return data.filter || [];
}

export async function createGmailFilter(
    accessToken: string,
    criteria: GmailFilterCriteria,
    action: GmailFilterAction
): Promise<GmailFilter> {
    return await gmailFetch(accessToken, '/settings/filters', {
        method: 'POST',
        body: JSON.stringify({ criteria, action }),
    });
}

export async function deleteGmailFilter(accessToken: string, filterId: string): Promise<void> {
    await gmailFetch(accessToken, `/settings/filters/${filterId}`, {
        method: 'DELETE',
    });
}
