// MCP Tool implementations for e-zer0
import type { Env, EmailAccount } from '../types';
import { decrypt, encrypt } from '../lib/crypto';
import {
    listGmailMessages,
    getGmailMessage,
    modifyGmailMessage,
    deleteGmailMessage,
    listGmailLabels,
    moveGmailToFolder,
} from '../lib/email/gmail';
import {
    listOutlookMessages,
    getOutlookMessage,
    deleteOutlookMessage,
    markOutlookMessageRead,
    listOutlookFolders,
    moveOutlookToFolder,
    listOutlookRules,
    createOutlookRule,
    updateOutlookRule,
    deleteOutlookRule,
} from '../lib/email/outlook';
import { indexEmail, searchSimilar, deleteFromIndex } from '../lib/vector';
import { sanitizeEmailContent } from '../lib/sanitizer';

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
    await db
        .prepare(
            `INSERT INTO audit_logs (client_id, client_name, action, target, details, success, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(clientId, clientName, action, target, details, success ? 1 : 0, errorMessage || null)
        .run();
}

// ── Helper to get decrypted access token ────────────────

async function getAccountToken(
    db: D1Database,
    accountId: number,
    encryptionKey: string,
    clientId: string
): Promise<{ account: EmailAccount; accessToken: string }> {
    // Authorize MCP client to access this account
    const permitted = await db
        .prepare(
            `
        SELECT 1 FROM mcp_client_accounts mca
        JOIN mcp_clients mc ON mc.id = mca.mcp_client_id
        WHERE mc.client_id = ? AND mca.email_account_id = ?
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

    // Index emails for semantic search (best-effort)
    try {
        for (const msg of messages) {
            const text = `${msg.subject} ${msg.snippet || ''}`;
            await indexEmail(env.VECTOR_INDEX, env.AI, account.id, msg.id, text);
        }
    } catch (e) {
        // Vector indexing is best-effort — don't fail the tool
        console.error('Vector indexing error:', e);
    }

    // Sanitize email content before returning (PII redaction + prompt injection detection)
    const sanitizedMessages = messages.map((msg: any) => {
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
}

export async function getEmails(
    env: Env,
    clientId: string,
    accountId: number,
    options: GetEmailsOptions
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    let messages;
    if (account.provider === 'google') {
        const { searchGmailMessages } = await import('../lib/email/gmail');
        messages = await searchGmailMessages(accessToken, options);
    } else {
        const { searchOutlookMessages } = await import('../lib/email/outlook');
        messages = await searchOutlookMessages(accessToken, options);
    }

    // Index emails for semantic search (best-effort)
    try {
        for (const msg of messages) {
            const text = `${msg.subject} ${msg.snippet || ''}`;
            await indexEmail(env.VECTOR_INDEX, env.AI, account.id, msg.id, text);
        }
    } catch (e) {
        // Vector indexing is best-effort — don't fail the tool
        console.error('Vector indexing error:', e);
    }

    // Sanitize email content before returning (PII redaction + prompt injection detection)
    const sanitizedMessages = messages.map((msg: any) => {
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

    return { account_id: accountId, provider: account.provider, messages: sanitizedMessages };
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
    accountId?: number,
    topK = 10
): Promise<any> {
    // 1. Pre-filter by authorized accounts to prevent vector metadata leakage
    const allowed = await env.DB.prepare(
        `SELECT email_account_id FROM mcp_client_accounts mca
         JOIN mcp_clients mc ON mc.id = mca.mcp_client_id
         WHERE mc.client_id = ?`
    )
        .bind(clientId)
        .all<{ email_account_id: number }>();

    const allowedAccountIds = allowed.results.map((r) => r.email_account_id);
    if (allowedAccountIds.length === 0) return { query, results: [] };

    let searchIds = allowedAccountIds;
    if (accountId) {
        if (!allowedAccountIds.includes(accountId)) {
            return { query, results: [] }; // Unauthorized specifically requested account
        }
        searchIds = [accountId];
    }

    const results = await searchSimilar(env.VECTOR_INDEX, env.AI, query, topK, searchIds);

    // Fetch full message details for top results
    const enrichedResults = [];
    for (const result of results.slice(0, 5)) {
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
    folder: string
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    let result;
    if (account.provider === 'google') {
        result = await moveGmailToFolder(accessToken, messageId, folder);
    } else {
        result = await moveOutlookToFolder(accessToken, messageId, folder);
    }

    return { success: true, account_id: accountId, message_id: messageId, ...result };
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
                name: f.name,
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

// ── Tool: create_email_rule ─────────────────────────────
export async function createEmailRule(
    env: Env,
    clientId: string,
    accountId: number,
    name: string,
    conditions: any,
    actions: any,
    applyToExisting: boolean = false
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        const { createGmailFilter } = await import('../lib/email/gmail');
        // Map unified conditions/actions to Gmail format
        const criteria: any = {};
        if (conditions.from) criteria.from = conditions.from.join(' OR ');
        if (conditions.to) criteria.to = conditions.to.join(' OR ');
        if (conditions.subject) criteria.subject = conditions.subject.join(' OR ');
        if (conditions.body) criteria.query = conditions.body.join(' OR ');

        const actionObj: any = {};
        if (actions.markAsRead) actionObj.removeLabelIds = ['UNREAD'];
        if (actions.moveToFolder) {
            actionObj.addLabelIds = [actions.moveToFolder];
            actionObj.removeLabelIds = [...(actionObj.removeLabelIds || []), 'INBOX'];
        }
        if (actions.delete) actionObj.addLabelIds = ['TRASH'];

        const filter = await createGmailFilter(accessToken, criteria, actionObj);

        if (applyToExisting) {
            const { applyRuleToExistingGmail } = await import('../lib/email/gmail');
            await applyRuleToExistingGmail(accessToken, conditions, actions);
        }

        return { success: true, account_id: accountId, provider: 'google', rule: filter };
    } else {
        // Outlook maps fairly directly
        const outCond: any = {};
        if (conditions.from) outCond.senderContains = conditions.from;
        if (conditions.to) outCond.recipientContains = conditions.to;
        if (conditions.subject) outCond.subjectContains = conditions.subject;
        if (conditions.body) outCond.bodyContains = conditions.body;

        const outAct: any = {};
        if (actions.markAsRead) outAct.markAsRead = true;
        if (actions.delete) outAct.delete = true;
        if (actions.moveToFolder) outAct.moveToFolder = actions.moveToFolder;

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
    conditions: any,
    actions: any,
    applyToExisting: boolean = false
): Promise<any> {
    const { account, accessToken } = await getAccountToken(env.DB, accountId, env.ENCRYPTION_KEY!, clientId);

    if (account.provider === 'google') {
        const { deleteGmailFilter } = await import('../lib/email/gmail');
        // Gmail doesn't support PATCH, must delete and recreate
        await deleteGmailFilter(accessToken, ruleId);
        return await createEmailRule(env, clientId, accountId, name, conditions, actions, applyToExisting);
    } else {
        const outCond: any = {};
        if (conditions.from) outCond.senderContains = conditions.from;
        if (conditions.to) outCond.recipientContains = conditions.to;
        if (conditions.subject) outCond.subjectContains = conditions.subject;
        if (conditions.body) outCond.bodyContains = conditions.body;

        const outAct: any = {};
        if (actions.markAsRead) outAct.markAsRead = true;
        if (actions.delete) outAct.delete = true;
        if (actions.moveToFolder) outAct.moveToFolder = actions.moveToFolder;

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
    } else {
        await deleteOutlookRule(accessToken, ruleId);
    }

    return { success: true, account_id: accountId, rule_id: ruleId };
}
