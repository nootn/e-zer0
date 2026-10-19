// MCP Tool implementations for e-zer0
import type { Env, EmailAccount, DraftReplyResult, EmailRuleActions, EmailRuleConditions } from '../types';
import {
    gmailLabelActions,
    previewGmailRule,
    applyGmailPreview,
    createGmailFilterSafely,
} from '../lib/email/label-rules';
import { decrypt, encrypt } from '../lib/crypto';
import {
    listGmailMessages,
    getGmailMessage,
    modifyGmailMessage,
    deleteGmailMessage,
    listGmailLabels,
    moveGmailToFolder,
    draftGmailReply,
} from '../lib/email/gmail';
import {
    listOutlookMessages,
    getOutlookMessage,
    deleteOutlookMessage,
    markOutlookMessageRead,
    listOutlookFolders,
    moveOutlookToFolder,
    draftOutlookReply,
    listOutlookRules,
    createOutlookRule,
    updateOutlookRule,
    deleteOutlookRule,
} from '../lib/email/outlook';
import { indexEmailsBatch, searchSimilar, deleteFromIndex } from '../lib/vector';
import { sanitizeEmailContent } from '../lib/sanitizer';
import { listProviderCalendars, getProviderCalendarEvents } from '../lib/calendar';
import {
    listGoogleTaskLists,
    listGoogleTasks,
    createGoogleTask,
    updateGoogleTask,
    deleteGoogleTask,
} from '../lib/tasks/google';
import {
    listMsTaskLists,
    getMsDefaultListId,
    listMsTasks,
    createMsTask,
    updateMsTask,
    deleteMsTask,
} from '../lib/tasks/microsoft';

// ── Audit Logger ────────────────────────────────────────

export async function logAudit(
    db: D1Database,
    clientId: string,
    clientName: string | null,
    action: string,
    target: string | null,
    details: string | null,
    success: boolean,
    errorMessage?: string
): Promise<void> {
    try {
        await db
            .prepare(
                `INSERT INTO audit_logs (client_id, client_name, action, target, details, success, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(clientId, clientName, action, target, details, success ? 1 : 0, errorMessage || null)
            .run();
    } catch (e) {
        // Audit logging must never break a tool call
        console.error('logAudit failed:', e);
    }
}

// ── Helper: sanitize a list of email messages ───────────

function sanitizeMessages(messages: any[]): any[] {
    return messages.map((msg: any) => {
        const subjectResult = sanitizeEmailContent(msg.subject || '');
        const snippetResult = sanitizeEmailContent(msg.snippet || '');
        const bodyResult = msg.body ? sanitizeEmailContent(msg.body) : null;
        return {
            ...msg,
            subject: subjectResult.sanitizedText,
            snippet: snippetResult.sanitizedText,
            body: bodyResult?.sanitizedText ?? msg.body,
            _security: {
                risk_score: Math.max(subjectResult.riskScore, snippetResult.riskScore, bodyResult?.riskScore ?? 0),
                redactions: [
                    ...subjectResult.redactions,
                    ...snippetResult.redactions,
                    ...(bodyResult?.redactions ?? []),
                ],
                injection_warnings: [
                    ...subjectResult.injectionWarnings,
                    ...snippetResult.injectionWarnings,
                    ...(bodyResult?.injectionWarnings ?? []),
                ],
            },
        };
    });
}

// ── Helper to get decrypted access token ────────────────

async function getAccountToken(
    db: D1Database,
    accountId: number,
    encryptionKey: string,
    clientId: string,
    access: 'mail' | 'calendar' = 'mail'
): Promise<{ account: EmailAccount; accessToken: string }> {
    // Authorize MCP client to access this account
    const permitted = await db
        .prepare(
            `
        SELECT 1 FROM ${access === 'calendar' ? 'mcp_client_calendar_accounts' : 'mcp_client_accounts'} mca
        JOIN mcp_clients mc ON mc.id = mca.mcp_client_id
        WHERE mc.client_id = ? AND mc.is_active = 1 AND mca.email_account_id = ?
    `
        )
        .bind(clientId, accountId)
        .first();

    if (!permitted) {
        throw new Error(`Account not found or access denied`);
    }

    const account = await db
        .prepare('SELECT * FROM email_accounts WHERE id = ? AND status = ?')
        .bind(accountId, 'active')
        .first<EmailAccount>();

    if (!account) throw new Error(`Account not found or access denied`);
    if (!account.encrypted_access_token) throw new Error(`Account not found or access denied`);

    try {
        const accessToken = await decrypt(account.encrypted_access_token, encryptionKey);
        return { account, accessToken };
    } catch (err: any) {
        console.error(`[DEBUG] getAccountToken decryption error: ${err.message}`, err);

        // Handle invalid key / token corruption edge case gracefully
        if (err.message?.includes('Decryption failed') || err.message?.includes('operation-specific reason')) {
            await db
                .prepare("UPDATE email_accounts SET status = ?, updated_at = datetime('now') WHERE id = ?")
                .bind('error', accountId)
                .run();
            throw new Error(
                `Email account ${account.email_address} encryption keys are invalid (likely due to a local key rotation). Please reconnect this account in your e-zer0 settings.`
            );
        }
        throw err;
    }
}

// ── Tool: list_connected_accounts ───────────────────────

export async function listConnectedAccounts(env: Env, clientId: string): Promise<any> {
    const result = await env.DB.prepare(
        `
        SELECT ea.id, ea.alias, ea.email_address, ea.provider, ea.status, ea.created_at
        FROM email_accounts ea
        JOIN mcp_client_accounts mca ON ea.id = mca.email_account_id
        JOIN mcp_clients mc ON mc.id = mca.mcp_client_id
        WHERE mc.client_id = ?
    `
    )
        .bind(clientId)
        .all();

    return {
        accounts: (result.results ?? []).map((a: any) => ({
            id: a.id,
            alias: a.alias,
            email: a.email_address,
            provider: a.provider,
            status: a.status,
        })),
    };
}

// ── Tool: read_recent_emails ────────────────────────────

export async function listCalendarAccounts(env: Env, clientId: string) {
    const result = await env.DB.prepare(
        `SELECT ea.id, ea.alias, ea.email_address, ea.provider, ea.status
        FROM email_accounts ea JOIN mcp_client_calendar_accounts ca ON ca.email_account_id = ea.id
        JOIN mcp_clients mc ON mc.id = ca.mcp_client_id WHERE mc.client_id = ? AND mc.is_active = 1`
    )
        .bind(clientId)
        .all();
    return { accounts: result.results || [] };
}

export async function listCalendars(env: Env, clientId: string, accountId: number, pageToken?: string) {
    const { account, accessToken } = await getAccountToken(
        env.DB,
        accountId,
        env.ENCRYPTION_KEY!,
        clientId,
        'calendar'
    );
    const result = await listProviderCalendars(account.provider, accessToken, pageToken);
    return {
        ...result,
        calendars: result.calendars.map((calendar) => {
            const clean = sanitizeEmailContent(calendar.name);
            return {
                ...calendar,
                name: clean.sanitizedText,
                _security: { risk_score: clean.riskScore, injection_warnings: clean.injectionWarnings },
            };
        }),
    };
}

export async function getCalendarEvents(
    env: Env,
    clientId: string,
    accountId: number,
    calendarId: string,
    start: string,
    end: string,
    count: number,
    pageToken?: string
) {
    const { account, accessToken } = await getAccountToken(
        env.DB,
        accountId,
        env.ENCRYPTION_KEY!,
        clientId,
        'calendar'
    );
    const result = await getProviderCalendarEvents(
        account.provider,
        accessToken,
        calendarId,
        start,
        end,
        count,
        pageToken
    );
    return {
        ...result,
        events: result.events.map((event) => {
            const clean = sanitizeMessages([
                { subject: event.title, snippet: event.location, body: event.description },
            ])[0];
            return {
                ...event,
                title: clean.subject,
                description: clean.body,
                location: clean.snippet,
                _security: clean._security,
            };
        }),
    };
}

export async function readRecentEmails(
    env: Env,
    clientId: string,
    accountId: number,
    count = 10,
    unreadOnly = false
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    let messages;
    if (account.provider === 'google') {
        messages = await listGmailMessages(accessToken, count, unreadOnly);
    } else {
        messages = await listOutlookMessages(accessToken, count, unreadOnly);
    }

    // Index emails for semantic search (best-effort, batched to minimise subrequests)
    try {
        await indexEmailsBatch(
            env.VECTOR_INDEX,
            env.AI,
            messages.map((msg: any) => ({
                accountId: account.id,
                messageId: msg.id,
                text: `${msg.subject} ${msg.snippet || ''}`,
            }))
        );
    } catch (e) {
        // Vector indexing is best-effort — don't fail the tool
        console.error('Vector indexing error:', e);
    }

    // Sanitize email content before returning (PII redaction + prompt injection detection)
    const sanitizedMessages = sanitizeMessages(messages);

    return { account_id: accountId, provider: account.provider, messages: sanitizedMessages };
}

// ── Tool: get_emails ────────────────────────────────────

export interface GetEmailsOptions {
    folder?: string;
    is_read?: boolean;
    from?: string;
    subject?: string;
    after?: string;
    before?: string;
    count: number;
    page_token?: string;
}

export async function getEmails(
    env: Env,
    clientId: string,
    accountId: number,
    options: GetEmailsOptions
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    const { page_token, ...criteria } = options;
    criteria.count = Math.max(1, Math.min(50, Math.floor(criteria.count)));
    if (!Number.isFinite(criteria.count)) throw new Error('Invalid email count');
    const query = JSON.stringify(
        Object.entries(criteria)
            .filter(([, value]) => value !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
    );
    let continuation: string | undefined;
    if (page_token) {
        const saved = JSON.parse(await decrypt(page_token, env.ENCRYPTION_KEY!));
        if (
            saved.clientId !== clientId ||
            saved.accountId !== accountId ||
            saved.query !== query ||
            saved.expires < Date.now()
        )
            throw new Error('Invalid or expired email page token; repeat the original query');
        continuation = saved.continuation;
    }
    let page;
    if (account.provider === 'google') {
        const { searchGmailMessagePage } = await import('../lib/email/gmail');
        page = await searchGmailMessagePage(accessToken, criteria, continuation);
    } else {
        const { searchOutlookMessagePage } = await import('../lib/email/outlook');
        page = await searchOutlookMessagePage(accessToken, criteria, continuation);
    }
    const messages = page.messages;

    // Index emails for semantic search (best-effort, batched to minimise subrequests)
    try {
        await indexEmailsBatch(
            env.VECTOR_INDEX,
            env.AI,
            messages.map((msg: any) => ({
                accountId: account.id,
                messageId: msg.id,
                text: `${msg.subject} ${msg.snippet || ''}`,
            }))
        );
    } catch (e) {
        // Vector indexing is best-effort — don't fail the tool
        console.error('Vector indexing error:', e);
    }

    // Sanitize email content before returning (PII redaction + prompt injection detection)
    const sanitizedMessages = sanitizeMessages(messages);

    const nextPageToken = page.next_page_token
        ? await encrypt(
              JSON.stringify({
                  clientId,
                  accountId,
                  query,
                  continuation: page.next_page_token,
                  expires: Date.now() + 30 * 60_000,
              }),
              env.ENCRYPTION_KEY!
          )
        : undefined;
    return {
        account_id: accountId,
        provider: account.provider,
        messages: sanitizedMessages,
        next_page_token: nextPageToken,
        exhausted: page.exhausted,
    };
}

// ── Tool: manage_email ──────────────────────────────────

export async function manageEmail(
    env: Env,
    clientId: string,
    accountId: number,
    messageId: string,
    action: 'archive' | 'delete' | 'mark_read' | 'mark_unread'
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        switch (action) {
            case 'archive':
                await modifyGmailMessage(accessToken, messageId, [], ['INBOX']);
                break;
            case 'delete':
                await deleteGmailMessage(accessToken, messageId);
                break;
            case 'mark_read':
                await modifyGmailMessage(accessToken, messageId, [], ['UNREAD']);
                break;
            case 'mark_unread':
                await modifyGmailMessage(accessToken, messageId, ['UNREAD'], []);
                break;
        }
    } else {
        switch (action) {
            case 'archive':
                // Outlook: move to Archive folder
                const { moveOutlookMessage } = await import('../lib/email/outlook');
                await moveOutlookMessage(accessToken, messageId, 'archive');
                break;
            case 'delete':
                await deleteOutlookMessage(accessToken, messageId);
                break;
            case 'mark_read':
                await markOutlookMessageRead(accessToken, messageId, true);
                break;
            case 'mark_unread':
                await markOutlookMessageRead(accessToken, messageId, false);
                break;
        }
    }

    // If deleting, also remove from vector index
    if (action === 'delete') {
        try {
            await deleteFromIndex(env.VECTOR_INDEX, accountId, messageId);
        } catch (e) {
            console.error('Vector delete error:', e);
        }
    }

    return { success: true, account_id: accountId, message_id: messageId, action };
}

// ── Tool: search_emails_semantic ────────────────────────

export async function searchEmailsSemantic(
    env: Env,
    clientId: string,
    query: string,
    accountId: number,
    topK = 10
): Promise<any> {
    // 1. Authorize explicitly requested account to prevent cross-tenant vector scanning
    const allowed = await env.DB.prepare(
        `SELECT 1 FROM mcp_client_accounts mca
         JOIN mcp_clients mc ON mc.id = mca.mcp_client_id
         WHERE mc.client_id = ? AND mca.email_account_id = ?`
    )
        .bind(clientId, accountId)
        .first();

    if (!allowed) return { query, results: [] };

    const results = await searchSimilar(env.VECTOR_INDEX, env.AI, query, topK, [accountId]);

    // Fetch full message details for top results
    const enrichedResults = [];
    for (const result of results.slice(0, Math.min(topK, 10))) {
        try {
            const { account, accessToken } = await getAccountToken(
                env.DB,
                result.accountId,
                env.ENCRYPTION_KEY!,
                clientId
            );
            let message;
            if (account.provider === 'google') {
                message = await getGmailMessage(accessToken, result.messageId);
            } else {
                message = await getOutlookMessage(accessToken, result.messageId);
            }
            // Sanitize message content
            const sanitized = sanitizeEmailContent(
                `${message.subject || ''} ${message.snippet || ''} ${message.body || ''}`
            );
            enrichedResults.push({
                ...message,
                subject: sanitizeEmailContent(message.subject || '').sanitizedText,
                snippet: sanitizeEmailContent(message.snippet || '').sanitizedText,
                body: message.body ? sanitizeEmailContent(message.body).sanitizedText : undefined,
                score: result.score,
                account_id: result.accountId,
                _security: {
                    risk_score: sanitized.riskScore,
                    redactions: sanitized.redactions,
                    injection_warnings: sanitized.injectionWarnings,
                },
            });
        } catch (e) {
            // Drop unauthorized or failed messages entirely to prevent data leakage/enumeration
            continue;
        }
    }

    return { query, results: enrichedResults };
}

// ── Tool: organize_email (unified folder/label) ────────

export async function organizeEmail(
    env: Env,
    clientId: string,
    accountId: number,
    messageId: string,
    folder: string,
    sourceLabel?: string
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    let result;
    if (account.provider === 'google') {
        result = await moveGmailToFolder(accessToken, messageId, folder, sourceLabel);
    } else {
        result = await moveOutlookToFolder(accessToken, messageId, folder);
    }

    return { success: true, account_id: accountId, message_id: messageId, ...result };
}

export async function draftEmailReply(
    env: Env,
    clientId: string,
    accountId: number,
    messageId: string,
    body: string
): Promise<DraftReplyResult & { success: true; account_id: number }> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    const draft =
        account.provider === 'google'
            ? await draftGmailReply(accessToken, messageId, body, account.email_address)
            : await draftOutlookReply(accessToken, messageId, body);
    return { success: true, account_id: accountId, ...draft };
}

// ── Tool: list_folders (unified folders/labels) ────────

export async function listEmailFolders(env: Env, clientId: string, accountId: number): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        const labels = await listGmailLabels(accessToken);
        return {
            account_id: accountId,
            provider: 'google',
            folders: labels.map((l) => ({
                id: l.id,
                name: l.name,
                type: l.type,
            })),
        };
    } else {
        const folders = await listOutlookFolders(accessToken);
        return {
            account_id: accountId,
            provider: 'microsoft',
            folders: folders.map((f) => ({
                id: f.id,
                name: f.path || f.name,
                type: 'folder' as const,
            })),
        };
    }
}

// ── Tool: list_email_rules ──────────────────────────────
export async function listEmailRules(env: Env, clientId: string, accountId: number): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        const { listGmailFilters } = await import('../lib/email/gmail');
        const filters = await listGmailFilters(accessToken);
        return { account_id: accountId, provider: 'google', rules: filters };
    } else {
        const rules = await listOutlookRules(accessToken);
        return { account_id: accountId, provider: 'microsoft', rules };
    }
}

function validateRuleCapabilities(
    provider: string,
    conditions: EmailRuleConditions,
    actions: EmailRuleActions,
    applyToExisting: boolean
) {
    const extended =
        conditions.query !== undefined ||
        conditions.negatedQuery !== undefined ||
        actions.addLabels !== undefined ||
        actions.removeLabels !== undefined ||
        actions.archive !== undefined;
    if (provider !== 'google' && extended)
        throw new Error(
            'Gmail query/negatedQuery and independent label/archive rule actions are not supported for Outlook. Use existing Outlook conditions and moveToFolder.'
        );
    if (extended && applyToExisting)
        throw new Error(
            'Extended Gmail rules require preview_email_rule and apply_email_rule_preview for existing mail; applyToExisting is supported only for legacy rules.'
        );
}

export async function getEmail(env: Env, clientId: string, accountId: number, messageId: string) {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    const message =
        account.provider === 'google'
            ? await getGmailMessage(accessToken, messageId)
            : await getOutlookMessage(accessToken, messageId);
    return {
        account_id: accountId,
        provider: account.provider,
        message: sanitizeMessages([message])[0],
        read_only: true,
    };
}

export async function searchEmailPage(
    env: Env,
    clientId: string,
    accountId: number,
    query: string | undefined,
    count: number,
    pageToken?: string
) {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    if (account.provider === 'google') {
        const { listGmailMessagePage } = await import('../lib/email/gmail');
        return {
            account_id: accountId,
            provider: account.provider,
            ...(await listGmailMessagePage(accessToken, query || 'in:inbox', count, pageToken)),
        };
    }
    if (query)
        throw new Error(
            'Gmail native search queries are not supported for Outlook; this paged endpoint lists the Outlook inbox'
        );
    const { listOutlookMessagePage } = await import('../lib/email/outlook');
    return {
        account_id: accountId,
        provider: account.provider,
        ...(await listOutlookMessagePage(accessToken, count, pageToken)),
    };
}

export async function manageEmailLabels(
    env: Env,
    clientId: string,
    accountId: number,
    operation: 'list' | 'create' | 'change',
    args: { name?: string; message_id?: string; actions?: EmailRuleActions }
) {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    if (account.provider !== 'google')
        throw new Error(
            'Independent label management is Gmail-only; Outlook folders are not labels. Use list_folders/organize_email for Outlook.'
        );
    if (operation === 'list') return { account_id: accountId, labels: await listGmailLabels(accessToken) };
    if (operation === 'create') {
        const { createGmailLabel } = await import('../lib/email/gmail');
        return { account_id: accountId, label: await createGmailLabel(accessToken, args.name!) };
    }
    const actions = args.actions!;
    const resolved = await gmailLabelActions(accessToken, actions);
    const current = await getGmailMessage(accessToken, args.message_id!);
    const desired = [
        ...new Set([...current.labels.filter((l) => !resolved.removeLabelIds.includes(l)), ...resolved.addLabelIds]),
    ];
    const already =
        resolved.addLabelIds.every((l) => current.labels.includes(l)) &&
        resolved.removeLabelIds.every((l) => !current.labels.includes(l));
    if (already)
        return {
            account_id: accountId,
            message_id: args.message_id,
            status: 'already_applied',
            labels: current.labels,
        };
    try {
        await modifyGmailMessage(accessToken, args.message_id!, resolved.addLabelIds, resolved.removeLabelIds);
    } catch {
        const after = await getGmailMessage(accessToken, args.message_id!);
        if (JSON.stringify([...after.labels].sort()) !== JSON.stringify(desired.sort()))
            throw new Error('Label write outcome uncertain; read message state before retrying');
        return { account_id: accountId, message_id: args.message_id, status: 'reconciled', labels: after.labels };
    }
    return { account_id: accountId, message_id: args.message_id, status: 'applied', labels: desired };
}

export async function previewEmailRule(
    env: Env,
    clientId: string,
    accountId: number,
    conditions: EmailRuleConditions,
    actions: EmailRuleActions,
    protectTerms: string[],
    count: number,
    pageToken?: string
) {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    if (account.provider !== 'google')
        throw new Error('Rule preview/application is currently Gmail-only; existing Outlook rule tools are unchanged');
    return {
        account_id: accountId,
        ...(await previewGmailRule(
            accessToken,
            env.ENCRYPTION_KEY!,
            clientId,
            accountId,
            conditions,
            actions,
            protectTerms,
            count,
            pageToken
        )),
    };
}

export async function applyEmailRulePreview(
    env: Env,
    clientId: string,
    accountId: number,
    previewToken: string,
    ids: string[]
) {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    if (account.provider !== 'google') throw new Error('Rule preview/application is Gmail-only');
    return {
        account_id: accountId,
        ...(await applyGmailPreview(accessToken, env.ENCRYPTION_KEY!, clientId, accountId, previewToken, ids)),
    };
}

// ── Tool: create_email_rule ─────────────────────────────
export async function createEmailRule(
    env: Env,
    clientId: string,
    accountId: number,
    name: string,
    conditions: EmailRuleConditions,
    actions: EmailRuleActions,
    applyToExisting: boolean = false
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    validateRuleCapabilities(account.provider, conditions, actions, applyToExisting);

    if (account.provider === 'google') {
        const { resolveGmailLabelId, buildGmailSearchClause } = await import('../lib/email/gmail');
        // Map unified conditions/actions to Gmail format
        const criteria: any = {};
        if (conditions.from) criteria.from = conditions.from.join(' OR ');
        if (conditions.to) criteria.to = conditions.to.join(' OR ');
        if (conditions.subject) criteria.subject = conditions.subject.join(' OR ');
        if (conditions.body) criteria.query = conditions.body.join(' OR ');
        if (conditions.query)
            criteria.query = [buildGmailSearchClause(undefined, conditions.body), `(${conditions.query})`]
                .filter(Boolean)
                .join(' ');
        if (conditions.negatedQuery) criteria.negatedQuery = conditions.negatedQuery;

        const actionObj: any = {};
        if (actions.markAsRead) actionObj.removeLabelIds = ['UNREAD'];
        if (actions.moveToFolder) {
            actionObj.addLabelIds = [await resolveGmailLabelId(accessToken, actions.moveToFolder, true)];
            actionObj.removeLabelIds = [...(actionObj.removeLabelIds || []), 'INBOX'];
        }
        if (actions.delete) actionObj.addLabelIds = [...(actionObj.addLabelIds || []), 'TRASH'];
        if (actions.addLabels?.length || actions.removeLabels?.length || actions.archive) {
            const independent = await gmailLabelActions(accessToken, {
                addLabels: actions.addLabels,
                removeLabels: actions.removeLabels,
                archive: actions.archive,
            });
            actionObj.addLabelIds = [...new Set([...(actionObj.addLabelIds || []), ...independent.addLabelIds])];
            actionObj.removeLabelIds = [
                ...new Set([...(actionObj.removeLabelIds || []), ...independent.removeLabelIds]),
            ];
        }
        if ((actionObj.addLabelIds || []).some((id: string) => actionObj.removeLabelIds?.includes(id)))
            throw new Error('Cannot add and remove the same label');

        const filter = await createGmailFilterSafely(env.DB, accountId, accessToken, criteria, actionObj);

        if (applyToExisting) {
            const { applyRuleToExistingGmail } = await import('../lib/email/gmail');
            const resolvedActions = { ...actions };
            if (actions.moveToFolder) {
                resolvedActions.moveToFolder = actionObj.addLabelIds?.[0];
            }
            await applyRuleToExistingGmail(accessToken, conditions, resolvedActions);
        }

        return { success: true, account_id: accountId, provider: 'google', rule: filter };
    } else {
        const { resolveOutlookFolderId } = await import('../lib/email/outlook');

        // Outlook maps fairly directly
        const outCond: any = {};
        if (conditions.from) outCond.senderContains = conditions.from;
        if (conditions.to) outCond.recipientContains = conditions.to;
        if (conditions.subject) outCond.subjectContains = conditions.subject;
        if (conditions.body) outCond.bodyContains = conditions.body;

        const outAct: any = {};
        if (actions.markAsRead) outAct.markAsRead = true;
        if (actions.delete) outAct.delete = true;
        if (actions.moveToFolder) {
            outAct.moveToFolder = await resolveOutlookFolderId(accessToken, actions.moveToFolder, true);
        }

        // Microsoft requires a sequence number, default to 10 for new rules
        const rule = await createOutlookRule(accessToken, name, 10, outCond, outAct);

        if (applyToExisting) {
            const { applyRuleToExistingOutlook } = await import('../lib/email/outlook');
            await applyRuleToExistingOutlook(accessToken, conditions, actions);
        }

        return { success: true, account_id: accountId, provider: 'microsoft', rule };
    }
}

// ── Tool: update_email_rule ─────────────────────────────
export async function updateEmailRule(
    env: Env,
    clientId: string,
    accountId: number,
    ruleId: string,
    name: string,
    conditions: EmailRuleConditions,
    actions: EmailRuleActions,
    applyToExisting: boolean = false
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    validateRuleCapabilities(account.provider, conditions, actions, applyToExisting);

    if (account.provider === 'google') {
        const { deleteGmailFilter } = await import('../lib/email/gmail');
        // Create/reconcile the replacement before removing the old filter.
        const replacement = await createEmailRule(env, clientId, accountId, name, conditions, actions, false);
        if (replacement.rule.id !== ruleId) {
            await deleteGmailFilter(accessToken, ruleId);
            await env.DB.prepare('DELETE FROM filter_write_intents WHERE account_id = ? AND provider_id = ?')
                .bind(accountId, ruleId)
                .run();
        }
        if (applyToExisting) await createEmailRule(env, clientId, accountId, name, conditions, actions, true);
        return replacement;
    } else {
        const { resolveOutlookFolderId } = await import('../lib/email/outlook');

        const outCond: any = {};
        if (conditions.from) outCond.senderContains = conditions.from;
        if (conditions.to) outCond.recipientContains = conditions.to;
        if (conditions.subject) outCond.subjectContains = conditions.subject;
        if (conditions.body) outCond.bodyContains = conditions.body;

        const outAct: any = {};
        if (actions.markAsRead) outAct.markAsRead = true;
        if (actions.delete) outAct.delete = true;
        if (actions.moveToFolder) {
            outAct.moveToFolder = await resolveOutlookFolderId(accessToken, actions.moveToFolder, true);
        }

        const rule = await updateOutlookRule(accessToken, ruleId, name, outCond, outAct);

        if (applyToExisting) {
            const { applyRuleToExistingOutlook } = await import('../lib/email/outlook');
            await applyRuleToExistingOutlook(accessToken, conditions, actions);
        }

        return { success: true, account_id: accountId, provider: 'microsoft', rule };
    }
}

// ── Tool: delete_email_rule ─────────────────────────────
export async function deleteEmailRule(env: Env, clientId: string, accountId: number, ruleId: string): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        const { deleteGmailFilter } = await import('../lib/email/gmail');
        await deleteGmailFilter(accessToken, ruleId);
        await env.DB.prepare('DELETE FROM filter_write_intents WHERE account_id = ? AND provider_id = ?')
            .bind(accountId, ruleId)
            .run();
    } else {
        await deleteOutlookRule(accessToken, ruleId);
    }

    return { success: true, account_id: accountId, rule_id: ruleId };
}

// ── Task Helpers ────────────────────────────────────────

function normalizeDue(due?: string): string | undefined {
    if (!due) return undefined;
    const d = new Date(due);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
}

// Unify a provider task into a sanitized shape with _security metadata.
function unifyTask(task: {
    id: string;
    title: string;
    notes?: string;
    status: string;
    due?: string;
    completed?: string;
    updated?: string;
}): any {
    const status = task.status === 'completed' ? 'completed' : 'open';
    const titleResult = sanitizeEmailContent(task.title || '');
    const notesResult = task.notes ? sanitizeEmailContent(task.notes) : null;
    return {
        id: task.id,
        title: titleResult.sanitizedText,
        notes: notesResult?.sanitizedText,
        status,
        due: task.due,
        completed_at: task.completed,
        updated: task.updated,
        _security: {
            risk_score: Math.max(titleResult.riskScore, notesResult?.riskScore ?? 0),
            redactions: [...titleResult.redactions, ...(notesResult?.redactions ?? [])],
            injection_warnings: [...titleResult.injectionWarnings, ...(notesResult?.injectionWarnings ?? [])],
        },
    };
}

// ── Tool: list_task_lists ───────────────────────────────

export async function listTaskLists(env: Env, clientId: string, accountId: number): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        const lists = await listGoogleTaskLists(accessToken);
        return { account_id: accountId, provider: 'google', task_lists: lists };
    } else {
        const lists = await listMsTaskLists(accessToken);
        return {
            account_id: accountId,
            provider: 'microsoft',
            task_lists: lists.map((l) => ({ id: l.id, title: l.title })),
        };
    }
}

// ── Tool: list_tasks ────────────────────────────────────

export async function listTasks(
    env: Env,
    clientId: string,
    accountId: number,
    listId?: string,
    includeCompleted = false,
    count?: number
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        const resolved = listId || '@default';
        const tasks = await listGoogleTasks(accessToken, resolved, includeCompleted, count);
        return { account_id: accountId, provider: 'google', list_id: resolved, tasks: tasks.map(unifyTask) };
    } else {
        const resolved = listId || (await getMsDefaultListId(accessToken));
        const tasks = await listMsTasks(accessToken, resolved, includeCompleted, count);
        return { account_id: accountId, provider: 'microsoft', list_id: resolved, tasks: tasks.map(unifyTask) };
    }
}

// ── Tool: create_task ───────────────────────────────────

export async function createTask(
    env: Env,
    clientId: string,
    accountId: number,
    title: string,
    notes?: string,
    due?: string,
    listId?: string
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    const dueIso = normalizeDue(due);

    if (account.provider === 'google') {
        const resolved = listId || '@default';
        const task = await createGoogleTask(accessToken, resolved, { title, notes, due: dueIso });
        return { success: true, account_id: accountId, provider: 'google', list_id: resolved, task: unifyTask(task) };
    } else {
        const resolved = listId || (await getMsDefaultListId(accessToken));
        const task = await createMsTask(accessToken, resolved, { title, notes, due: dueIso });
        return {
            success: true,
            account_id: accountId,
            provider: 'microsoft',
            list_id: resolved,
            task: unifyTask(task),
        };
    }
}

// ── Tool: update_task ───────────────────────────────────

export async function updateTask(
    env: Env,
    clientId: string,
    accountId: number,
    taskId: string,
    updates: { title?: string; notes?: string; due?: string; status?: 'open' | 'completed' },
    listId?: string
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);
    const dueIso = updates.due !== undefined ? normalizeDue(updates.due) : undefined;

    if (account.provider === 'google') {
        const resolved = listId || '@default';
        const status = updates.status ? (updates.status === 'completed' ? 'completed' : 'needsAction') : undefined;
        const task = await updateGoogleTask(accessToken, resolved, taskId, {
            title: updates.title,
            notes: updates.notes,
            due: dueIso,
            status,
        });
        return { success: true, account_id: accountId, provider: 'google', list_id: resolved, task: unifyTask(task) };
    } else {
        const resolved = listId || (await getMsDefaultListId(accessToken));
        const status = updates.status ? (updates.status === 'completed' ? 'completed' : 'notStarted') : undefined;
        const task = await updateMsTask(accessToken, resolved, taskId, {
            title: updates.title,
            notes: updates.notes,
            due: dueIso,
            status,
        });
        return {
            success: true,
            account_id: accountId,
            provider: 'microsoft',
            list_id: resolved,
            task: unifyTask(task),
        };
    }
}

// ── Tool: delete_task ───────────────────────────────────

export async function deleteTask(
    env: Env,
    clientId: string,
    accountId: number,
    taskId: string,
    listId?: string
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        await deleteGoogleTask(accessToken, listId || '@default', taskId);
    } else {
        const resolved = listId || (await getMsDefaultListId(accessToken));
        await deleteMsTask(accessToken, resolved, taskId);
    }

    return { success: true, account_id: accountId, task_id: taskId };
}
