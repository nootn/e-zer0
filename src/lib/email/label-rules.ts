import type { EmailRuleActions, EmailRuleConditions, EmailChangePreview } from '../../types';
import { encrypt, decrypt } from '../crypto';
import {
    buildGmailSearchClause,
    getGmailMessage,
    listGmailLabels,
    listGmailMessagePage,
    modifyGmailMessage,
    getGmailMessageLabels,
    createGmailFilter,
    findGmailFilter,
} from './gmail';
import type { GmailFilterCriteria, GmailFilterAction } from './gmail';
import type { EmailMessage } from './gmail';

export function gmailRuleQuery(conditions: EmailRuleConditions): string {
    const positive = [
        buildGmailSearchClause('from', conditions.from),
        buildGmailSearchClause('to', conditions.to),
        buildGmailSearchClause('subject', conditions.subject),
        buildGmailSearchClause(undefined, conditions.body),
        conditions.query ? `(${conditions.query})` : undefined,
    ]
        .filter(Boolean)
        .join(' ');
    if (!positive) throw new Error('At least one positive rule condition is required');
    return [positive, conditions.negatedQuery ? `-(${conditions.negatedQuery})` : ''].filter(Boolean).join(' ');
}

export async function gmailLabelActions(
    token: string,
    actions: EmailRuleActions
): Promise<{ addLabelIds: string[]; removeLabelIds: string[] }> {
    const labels = await listGmailLabels(token);
    const resolve = (ref: string): string => {
        const found = labels.find((label) => label.id === ref || label.name.toLowerCase() === ref.toLowerCase());
        if (!found || found.type !== 'user')
            throw new Error('Label operations require an existing custom label ID or name; create the label first');
        return found.id;
    };
    const add = (actions.addLabels || []).map(resolve);
    const remove = (actions.removeLabels || []).map(resolve);
    if (actions.moveToFolder) {
        add.push(resolve(actions.moveToFolder));
        remove.push('INBOX');
    }
    if (actions.archive) remove.push('INBOX');
    if (actions.markAsRead) remove.push('UNREAD');
    if (actions.delete) add.push('TRASH');
    if (add.some((id) => remove.includes(id))) throw new Error('Cannot add and remove the same label');
    if (!add.length && !remove.length) throw new Error('At least one action is required');
    return { addLabelIds: [...new Set(add)], removeLabelIds: [...new Set(remove)] };
}

export function planGmailChanges(message: EmailMessage, actions: EmailRuleActions, protectTerms: string[]) {
    if (message.is_calendar || !message.body_complete)
        return {
            addLabelIds: [],
            removeLabelIds: [],
            reason: message.is_calendar ? 'calendar invitation: untouched' : 'incomplete body: untouched',
        };
    const text = `${message.subject} ${message.body || ''}`.toLowerCase();
    // Conservative visible-text guard, not a complete HTML parser. Unknown entities keep INBOX.
    const entities: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    const decoded = text
        .replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_, value: string) => {
            const code = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
            return code <= 0x10ffff ? String.fromCodePoint(code) : '&unknown;';
        })
        .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name: string) => entities[name.toLowerCase()])
        .replace(/[\u200b-\u200f\ufeff]/g, '')
        .normalize('NFKC')
        .toLowerCase();
    const visible = decoded.replace(/<[^>]*>/g, '');
    const spaced = decoded.replace(/<[^>]*>/g, ' ');
    const protectedMention =
        /&(?:#[a-z0-9]|[a-z]{2,})/i.test(visible) ||
        [text, visible, spaced].some(
            (candidate) =>
                protectTerms.some((term) => candidate.includes(term.toLowerCase())) ||
                /mentioned\s+you/i.test(candidate)
        );
    const add = [...(actions.addLabels || []), ...(actions.delete ? ['TRASH'] : [])];
    const remove = [
        ...(actions.removeLabels || []),
        ...(actions.markAsRead ? ['UNREAD'] : []),
        ...(actions.archive && !protectedMention ? ['INBOX'] : []),
    ];
    return {
        addLabelIds: add.filter((id) => !message.labels.includes(id)),
        removeLabelIds: remove.filter((id) => message.labels.includes(id)),
        reason:
            protectedMention && actions.archive
                ? 'possible mention: keep INBOX'
                : actions.archive
                  ? 'archive requires explicit full-body review; unknown mention formats are possible'
                  : undefined,
    };
}

async function fingerprint(message: EmailMessage): Promise<string> {
    const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
            JSON.stringify([
                message.id,
                message.from,
                message.to,
                message.subject,
                message.body,
                message.body_complete,
                message.is_calendar,
            ])
        )
    );
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function matchesLiteralConditions(message: EmailMessage, conditions: EmailRuleConditions): boolean {
    const address = /<([^>]+)>/.exec(message.from)?.[1] || message.from.trim();
    return (
        (!conditions.from?.length || conditions.from.some((value) => address.toLowerCase() === value.toLowerCase())) &&
        (!conditions.to?.length ||
            conditions.to.some((value) => message.to.toLowerCase().includes(value.toLowerCase()))) &&
        (!conditions.subject?.length ||
            conditions.subject.some((value) => message.subject.toLowerCase().includes(value.toLowerCase()))) &&
        (!conditions.body?.length ||
            conditions.body.some((value) => (message.body || '').toLowerCase().includes(value.toLowerCase())))
    );
}

interface PreviewToken {
    version: 1;
    client: string;
    account: number;
    expires: number;
    messages: EmailChangePreview[];
}

export async function createGmailFilterSafely(
    db: D1Database,
    account: number,
    token: string,
    criteria: GmailFilterCriteria,
    action: GmailFilterAction
) {
    const existing = await findGmailFilter(token, criteria, action);
    if (existing) return existing;
    const definition = JSON.stringify({ criteria, action }, (_, value) => {
        if (Array.isArray(value)) return [...value].sort();
        if (value && typeof value === 'object')
            return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
        return value;
    });
    const owner = crypto.randomUUID();
    await db
        .prepare(
            'INSERT INTO filter_write_intents (account_id, definition, owner) VALUES (?, ?, ?) ON CONFLICT DO NOTHING'
        )
        .bind(account, definition, owner)
        .run();
    const claim = await db
        .prepare('SELECT owner FROM filter_write_intents WHERE account_id = ? AND definition = ?')
        .bind(account, definition)
        .first<{ owner: string }>();
    if (claim?.owner !== owner) {
        const reconciled = await findGmailFilter(token, criteria, action);
        if (reconciled) return reconciled;
        throw new Error(
            'Filter creation pending or uncertain. No duplicate POST was sent. Reconcile with list_email_rules; administrator intervention is required if the filter remains absent.'
        );
    }
    try {
        const filter = await createGmailFilter(token, criteria, action);
        await db
            .prepare(
                'UPDATE filter_write_intents SET provider_id = ? WHERE account_id = ? AND definition = ? AND owner = ?'
            )
            .bind(filter.id, account, definition, owner)
            .run();
        return filter;
    } catch (error) {
        // Only definite provider rejection releases the claim. Lost responses never trigger a second POST.
        if (error instanceof Error && /Gmail API error \((400|401|403|404|429)\)/.test(error.message)) {
            await db
                .prepare('DELETE FROM filter_write_intents WHERE account_id = ? AND definition = ? AND owner = ?')
                .bind(account, definition, owner)
                .run();
        }
        throw error;
    }
}

export async function previewGmailRule(
    token: string,
    key: string,
    client: string,
    account: number,
    conditions: EmailRuleConditions,
    actions: EmailRuleActions,
    protectTerms: string[],
    count = 5,
    pageToken?: string
) {
    const query = gmailRuleQuery(conditions);
    const resolved = await gmailLabelActions(token, actions);
    const normalized: EmailRuleActions = {
        addLabels: resolved.addLabelIds.filter((id) => id !== 'TRASH'),
        removeLabels: resolved.removeLabelIds.filter((id) => id !== 'INBOX' && id !== 'UNREAD'),
        archive: resolved.removeLabelIds.includes('INBOX'),
        markAsRead: resolved.removeLabelIds.includes('UNREAD'),
        delete: resolved.addLabelIds.includes('TRASH'),
    };
    const page = await listGmailMessagePage(token, query, count, pageToken);
    const messages: EmailChangePreview[] = [];
    for (const id of page.message_ids) {
        const message = await getGmailMessage(token, id);
        const changes = matchesLiteralConditions(message, conditions)
            ? planGmailChanges(message, normalized, protectTerms)
            : { addLabelIds: [], removeLabelIds: [], reason: 'literal sender/condition mismatch: untouched' };
        messages.push({ id, ...changes, before: [...message.labels].sort(), fingerprint: await fingerprint(message) });
    }
    const payload: PreviewToken = { version: 1, client, account, expires: Date.now() + 15 * 60_000, messages };
    return {
        messages,
        next_page_token: page.next_page_token,
        preview_token: await encrypt(JSON.stringify(payload), key),
        expires_at: new Date(payload.expires).toISOString(),
        requires_review: true,
    };
}

export async function applyGmailPreview(
    token: string,
    key: string,
    client: string,
    account: number,
    previewToken: string,
    reviewedIds: string[]
) {
    const plan: PreviewToken = JSON.parse(await decrypt(previewToken, key));
    if (plan.version !== 1 || plan.client !== client || plan.account !== account || plan.expires <= Date.now())
        throw new Error('Invalid, expired or cross-account preview');
    if (!reviewedIds.length || reviewedIds.some((id) => !plan.messages.some((m) => m.id === id)))
        throw new Error('Review only message IDs from this preview');
    const results: { id: string; status: string; error?: string }[] = [];
    const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    for (const id of [...new Set(reviewedIds)]) {
        const expected = plan.messages.find((m) => m.id === id)!;
        try {
            if (!expected.addLabelIds.length && !expected.removeLabelIds.length) {
                results.push({ id, status: 'unchanged' });
                continue;
            }
            const current = await getGmailMessage(token, id);
            if ((await fingerprint(current)) !== expected.fingerprint)
                throw new Error('Message content changed; obtain a new preview');
            const desired = [
                ...new Set([
                    ...expected.before.filter((l) => !expected.removeLabelIds.includes(l)),
                    ...expected.addLabelIds,
                ]),
            ];
            if (same(current.labels, desired)) {
                results.push({ id, status: 'already_applied' });
                continue;
            }
            if (!same(current.labels, expected.before))
                throw new Error('Message labels/read state changed; obtain a new preview');
            try {
                await modifyGmailMessage(token, id, expected.addLabelIds, expected.removeLabelIds);
                results.push({ id, status: 'applied' });
            } catch {
                const after = await getGmailMessageLabels(token, id);
                if (!same(after, desired))
                    throw new Error('Write outcome uncertain; re-preview/reconcile before retrying');
                results.push({ id, status: 'reconciled' });
            }
        } catch (error) {
            results.push({ id, status: 'failed', error: error instanceof Error ? error.message : 'Operation failed' });
        }
    }
    return { success: results.every((r) => r.status !== 'failed'), results };
}
