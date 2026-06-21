// MCP Server setup using @modelcontextprotocol/sdk
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../types';
import {
    listConnectedAccounts,
    readRecentEmails,
    manageEmail,
    organizeEmail,
    listEmailFolders,
    searchEmailsSemantic,
    logAudit,
    listEmailRules,
    createEmailRule,
    updateEmailRule,
    deleteEmailRule,
    getEmails,
    listTaskLists,
    listTasks,
    createTask,
    updateTask,
    deleteTask,
} from './tools';

async function handleToolError(env: Env, accountId: number | undefined, e: any) {
    if (
        accountId &&
        e.message &&
        (e.message.includes('(401)') ||
            e.message.includes('Unauthenticated') ||
            e.message.includes('Invalid Authentication'))
    ) {
        try {
            await env.DB.prepare(
                "UPDATE email_accounts SET status = 'error', updated_at = datetime('now') WHERE id = ?"
            )
                .bind(accountId)
                .run();
        } catch (dbErr) {
            console.error('Failed to update account status:', dbErr);
        }
    }
}

export function createMcpServer(env: Env, clientId: string, clientName: string | null): McpServer {
    const server = new McpServer({
        name: 'e-zer0',
        version: '1.0.0',
        icons: [
            {
                src: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Ctext%20y%3D%22.9em%22%20font-size%3D%2290%22%3E%E2%9A%A1%3C%2Ftext%3E%3C%2Fsvg%3E',
            },
        ],
    });

    // ── Tool: list_connected_accounts ───────────────────
    server.tool(
        'list_connected_accounts',
        'List all email accounts connected to this e-zer0 instance',
        {},
        async () => {
            try {
                const result = await listConnectedAccounts(env, clientId);
                await logAudit(env.DB, clientId, clientName, 'list_connected_accounts', null, null, true);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await logAudit(env.DB, clientId, clientName, 'list_connected_accounts', null, null, false, e.message);
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: read_recent_emails ────────────────────────
    server.tool(
        'read_recent_emails',
        'Read recent emails from a connected email account',
        {
            account_id: z.number().describe('The ID of the email account to read from'),
            count: z
                .number()
                .optional()
                .default(10)
                .describe('Number of recent emails to fetch (default: 10, max: 50)'),
            unread_only: z.boolean().optional().default(false).describe('Only fetch unread emails'),
        },
        async ({ account_id, count, unread_only }) => {
            try {
                const clampedCount = Math.min(count, 50);
                const result = await readRecentEmails(env, clientId, account_id, clampedCount, unread_only);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'read_recent_emails',
                    `account:${account_id}`,
                    `count:${clampedCount}`,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'read_recent_emails',
                    `account:${account_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: get_emails ────────────────────────────────
    server.tool(
        'get_emails',
        'Advanced search and fetch of emails with filtering. This is generally preferred over read_recent_emails if you need specific folders or search terms. Outlook "other" inbox is supported by setting folder to "other". IF the user requests emails by a relative date (e.g. "today", "yesterday") and you do NOT know their timezone, explicitly ask them for their timezone or location first so you can accurately determine the correct timezone offset and avoid defaulting to GMT.',
        {
            account_id: z.number().describe('The ID of the email account'),
            folder: z
                .string()
                .optional()
                .describe('Folder name or ID (e.g. "inbox", "archive", "other"). Defaults to "inbox".'),
            is_read: z
                .boolean()
                .optional()
                .describe('Filter by read status: true for read, false for unread, omit for both.'),
            from: z.string().optional().describe('Search for emails from this sender'),
            subject: z.string().optional().describe('Search for emails with this in the subject'),
            after: z
                .string()
                .optional()
                .describe(
                    "Only fetch emails received after this date. Use full ISO 8601 with timezone offset (e.g., '2026-03-05T00:00:00+10:00') for accurate local time processing (especially for 'today', 'yesterday' etc). YYYY-MM-DD fallback is allowed but defaults to UTC/GMT."
                ),
            before: z
                .string()
                .optional()
                .describe(
                    "Only fetch emails received before this date. Use full ISO 8601 with timezone offset (e.g., '2026-03-05T23:59:59+10:00') for accurate local time processing. YYYY-MM-DD fallback is allowed."
                ),
            count: z.number().optional().default(10).describe('Max number of emails to return (max 50)'),
        },
        async ({ account_id, folder, is_read, from, subject, after, before, count }) => {
            try {
                const clampedCount = Math.min(count, 50);
                const result = await getEmails(env, clientId, account_id, {
                    folder,
                    is_read,
                    from,
                    subject,
                    after,
                    before,
                    count: clampedCount,
                });
                await logAudit(env.DB, clientId, clientName, 'get_emails', `account:${account_id}`, null, true);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'get_emails',
                    `account:${account_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: manage_email ──────────────────────────────
    server.tool(
        'manage_email',
        'Perform an action on a specific email (archive, delete, mark as read/unread)',
        {
            account_id: z.number().describe('The ID of the email account'),
            message_id: z.string().describe('The ID of the email message'),
            action: z.enum(['archive', 'delete', 'mark_read', 'mark_unread']).describe('The action to perform'),
        },
        async ({ account_id, message_id, action }) => {
            try {
                const result = await manageEmail(env, clientId, account_id, message_id, action);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'manage_email',
                    `account:${account_id}:${message_id}`,
                    `action:${action}`,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'manage_email',
                    `account:${account_id}:${message_id}`,
                    `action:${action}`,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: organize_email (unified folder/label) ─────
    server.tool(
        'organize_email',
        'Move an email to a folder or apply a label. Works the same across Gmail and Outlook — use folder names like "Archive", "Spam", "Promotions", "Updates", or any custom folder/label name. e-zer0 translates automatically between Gmail labels and Outlook folders.',
        {
            account_id: z.number().describe('The ID of the email account'),
            message_id: z.string().describe('The ID of the email message'),
            folder: z
                .string()
                .describe('Folder/label name (e.g. "Archive", "Spam", "Promotions", "Important", or a custom name)'),
        },
        async ({ account_id, message_id, folder }) => {
            try {
                const result = await organizeEmail(env, clientId, account_id, message_id, folder);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'organize_email',
                    `account:${account_id}:${message_id}`,
                    `folder:${folder}`,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'organize_email',
                    `account:${account_id}:${message_id}`,
                    `folder:${folder}`,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: list_folders ──────────────────────────────
    server.tool(
        'list_folders',
        'List all available folders (Outlook) or labels (Gmail) for an email account. Returns a unified list.',
        {
            account_id: z.number().describe('The ID of the email account'),
        },
        async ({ account_id }) => {
            try {
                const result = await listEmailFolders(env, clientId, account_id);
                await logAudit(env.DB, clientId, clientName, 'list_folders', `account:${account_id}`, null, true);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'list_folders',
                    `account:${account_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: search_emails_semantic ────────────────────
    server.tool(
        'search_emails_semantic',
        'Semantically search across indexed emails using natural language (e.g. "flight bookings", "invoices from Amazon")',
        {
            query: z.string().describe('Natural language search query'),
            account_id: z.number().describe('The ID of the email account to search within'),
            top_k: z.number().optional().default(10).describe('Number of results to return (default: 10)'),
        },
        async ({ query, account_id, top_k }) => {
            try {
                const result = await searchEmailsSemantic(env, clientId, query, account_id, top_k);
                await logAudit(env.DB, clientId, clientName, 'search_emails_semantic', null, `query:"${query}"`, true);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'search_emails_semantic',
                    null,
                    `query:"${query}"`,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: list_email_rules ──────────────────────────
    server.tool(
        'list_email_rules',
        'List all automated email rules (Outlook) or filters (Gmail) for an account',
        {
            account_id: z.number().describe('The ID of the email account'),
        },
        async ({ account_id }) => {
            try {
                const result = await listEmailRules(env, clientId, account_id);
                await logAudit(env.DB, clientId, clientName, 'list_email_rules', `account:${account_id}`, null, true);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'list_email_rules',
                    `account:${account_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: create_email_rule ─────────────────────────
    server.tool(
        'create_email_rule',
        'Create a new automated email rule (Outlook) or filter (Gmail)',
        {
            account_id: z.number().describe('The ID of the email account'),
            name: z.string().describe('Name of the rule (used in Outlook, ignored in Gmail)'),
            conditions: z
                .object({
                    from: z.array(z.string()).optional().describe('Apply to emails from these senders'),
                    to: z.array(z.string()).optional().describe('Apply to emails sent to these addresses'),
                    subject: z.array(z.string()).optional().describe('Apply to emails with these words in subject'),
                    body: z.array(z.string()).optional().describe('Apply to emails with these words in body'),
                })
                .describe('Conditions that trigger the rule'),
            actions: z
                .object({
                    markAsRead: z.boolean().optional().describe('Mark matching emails as read'),
                    delete: z.boolean().optional().describe('Delete matching emails (move to trash)'),
                    moveToFolder: z
                        .string()
                        .optional()
                        .describe(
                            'Move matching emails to this folder. For Gmail, you may use a label ID, label name, or nested path like "Projects/Active". For Outlook, you may use a folder ID, folder name, or nested path like "Projects/Active".'
                        ),
                })
                .describe('Actions to perform when conditions are met'),
            applyToExisting: z
                .boolean()
                .optional()
                .default(false)
                .describe('Set to true to also apply this rule retroactively to existing matching emails in the inbox'),
        },
        async ({ account_id, name, conditions, actions, applyToExisting }) => {
            try {
                const result = await createEmailRule(
                    env,
                    clientId,
                    account_id,
                    name,
                    conditions,
                    actions,
                    applyToExisting
                );
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'create_email_rule',
                    `account:${account_id}`,
                    `name:${name}`,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'create_email_rule',
                    `account:${account_id}`,
                    `name:${name}`,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: update_email_rule ─────────────────────────
    server.tool(
        'update_email_rule',
        'Update an existing email rule. Note: For Gmail, this deletes and recreates the rule entirely.',
        {
            account_id: z.number().describe('The ID of the email account'),
            rule_id: z.string().describe('The ID of the rule to update'),
            name: z.string().describe('New name of the rule'),
            conditions: z
                .object({
                    from: z.array(z.string()).optional(),
                    to: z.array(z.string()).optional(),
                    subject: z.array(z.string()).optional(),
                    body: z.array(z.string()).optional(),
                })
                .describe('Full new condition set for the rule'),
            actions: z
                .object({
                    markAsRead: z.boolean().optional(),
                    delete: z.boolean().optional(),
                    moveToFolder: z
                        .string()
                        .optional()
                        .describe(
                            'For Gmail, you may use a label ID, label name, or nested path like "Projects/Active". For Outlook, you may use a folder ID, folder name, or nested path like "Projects/Active".'
                        ),
                })
                .describe('Full new action set for the rule'),
            applyToExisting: z
                .boolean()
                .optional()
                .default(false)
                .describe(
                    'Set to true to also apply this updated rule retroactively to existing matching emails in the inbox'
                ),
        },
        async ({ account_id, rule_id, name, conditions, actions, applyToExisting }) => {
            try {
                const result = await updateEmailRule(
                    env,
                    clientId,
                    account_id,
                    rule_id,
                    name,
                    conditions,
                    actions,
                    applyToExisting
                );
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'update_email_rule',
                    `account:${account_id}:${rule_id}`,
                    null,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'update_email_rule',
                    `account:${account_id}:${rule_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: delete_email_rule ─────────────────────────
    server.tool(
        'delete_email_rule',
        'Delete an email rule (Outlook) or filter (Gmail)',
        {
            account_id: z.number().describe('The ID of the email account'),
            rule_id: z.string().describe('The ID of the rule to delete'),
        },
        async ({ account_id, rule_id }) => {
            try {
                const result = await deleteEmailRule(env, clientId, account_id, rule_id);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'delete_email_rule',
                    `account:${account_id}:${rule_id}`,
                    null,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'delete_email_rule',
                    `account:${account_id}:${rule_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: list_task_lists ───────────────────────────
    server.tool(
        'list_task_lists',
        'List the task lists (Google Tasks lists or Microsoft To Do lists) for a connected email account. Use this to discover list IDs before creating or listing tasks. Gmail accounts use Google Tasks; Outlook/Microsoft accounts use Microsoft To Do.',
        {
            account_id: z.number().describe('The ID of the email account'),
        },
        async ({ account_id }) => {
            try {
                const result = await listTaskLists(env, clientId, account_id);
                await logAudit(env.DB, clientId, clientName, 'list_task_lists', `account:${account_id}`, null, true);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'list_task_lists',
                    `account:${account_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: list_tasks ────────────────────────────────
    server.tool(
        'list_tasks',
        'List tasks (to-dos) from a connected email account. Works across Gmail (Google Tasks) and Outlook (Microsoft To Do). If list_id is omitted, the account default task list is used. By default only open/incomplete tasks are returned.',
        {
            account_id: z.number().describe('The ID of the email account'),
            list_id: z
                .string()
                .optional()
                .describe('Task list ID (from list_task_lists). Omit to use the default list.'),
            include_completed: z
                .boolean()
                .optional()
                .default(false)
                .describe('Set true to also include completed tasks'),
            count: z
                .number()
                .optional()
                .describe('Max number of tasks to return. Omit to return ALL tasks (paged automatically).'),
        },
        async ({ account_id, list_id, include_completed, count }) => {
            try {
                const result = await listTasks(env, clientId, account_id, list_id, include_completed, count);
                await logAudit(env.DB, clientId, clientName, 'list_tasks', `account:${account_id}`, null, true);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'list_tasks',
                    `account:${account_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: create_task ───────────────────────────────
    server.tool(
        'create_task',
        'Create a new task (to-do) in a connected email account. Works across Gmail (Google Tasks) and Outlook (Microsoft To Do). If list_id is omitted, the task is added to the default list.',
        {
            account_id: z.number().describe('The ID of the email account'),
            title: z.string().describe('The task title / summary'),
            notes: z.string().optional().describe('Optional longer notes/description for the task'),
            due: z
                .string()
                .optional()
                .describe(
                    'Optional due date. Use ISO 8601 (e.g. "2026-06-25" or "2026-06-25T00:00:00Z"). Note: Google Tasks only honors the date portion.'
                ),
            list_id: z
                .string()
                .optional()
                .describe('Task list ID (from list_task_lists). Omit to use the default list.'),
        },
        async ({ account_id, title, notes, due, list_id }) => {
            try {
                const result = await createTask(env, clientId, account_id, title, notes, due, list_id);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'create_task',
                    `account:${account_id}`,
                    `title:${title}`,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'create_task',
                    `account:${account_id}`,
                    `title:${title}`,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: update_task ───────────────────────────────
    server.tool(
        'update_task',
        'Update an existing task (to-do): change its title, notes, due date, or mark it complete/open. Works across Gmail (Google Tasks) and Outlook (Microsoft To Do). To mark a task done, set status to "completed".',
        {
            account_id: z.number().describe('The ID of the email account'),
            task_id: z.string().describe('The ID of the task to update'),
            list_id: z.string().optional().describe('Task list ID the task belongs to. Omit to use the default list.'),
            title: z.string().optional().describe('New title'),
            notes: z.string().optional().describe('New notes/description'),
            due: z.string().optional().describe('New due date (ISO 8601, e.g. "2026-06-25")'),
            status: z
                .enum(['open', 'completed'])
                .optional()
                .describe('Set "completed" to mark done, or "open" to reopen'),
        },
        async ({ account_id, task_id, list_id, title, notes, due, status }) => {
            try {
                const result = await updateTask(
                    env,
                    clientId,
                    account_id,
                    task_id,
                    { title, notes, due, status },
                    list_id
                );
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'update_task',
                    `account:${account_id}:${task_id}`,
                    null,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'update_task',
                    `account:${account_id}:${task_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    // ── Tool: delete_task ───────────────────────────────
    server.tool(
        'delete_task',
        'Delete a task (to-do) from a connected email account. Works across Gmail (Google Tasks) and Outlook (Microsoft To Do).',
        {
            account_id: z.number().describe('The ID of the email account'),
            task_id: z.string().describe('The ID of the task to delete'),
            list_id: z.string().optional().describe('Task list ID the task belongs to. Omit to use the default list.'),
        },
        async ({ account_id, task_id, list_id }) => {
            try {
                const result = await deleteTask(env, clientId, account_id, task_id, list_id);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'delete_task',
                    `account:${account_id}:${task_id}`,
                    null,
                    true
                );
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } catch (e: any) {
                await handleToolError(env, account_id, e);
                await logAudit(
                    env.DB,
                    clientId,
                    clientName,
                    'delete_task',
                    `account:${account_id}:${task_id}`,
                    null,
                    false,
                    e.message
                );
                return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
            }
        }
    );

    return server;
}
