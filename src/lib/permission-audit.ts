// Run first in the mutation batch: snapshots and the success audit commit or roll back together.
export function permissionAuditStatement(
    db: D1Database,
    agentId: string | number,
    userId: number | undefined,
    action:
        | 'agent_permissions_updated'
        | 'agent_calendar_permissions_updated'
        | 'oauth_permissions_updated'
        | 'agent_revoked',
    emailIds?: number[],
    calendarIds?: number[]
) {
    const id = Number(agentId);
    if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        (typeof agentId === 'string' && agentId !== String(id)) ||
        (userId !== undefined && (!Number.isSafeInteger(userId) || userId <= 0))
    ) {
        throw new Error('Invalid permission audit identity');
    }
    const selection = (ids?: number[]) =>
        ids === undefined ? null : JSON.stringify([...new Set(ids)].sort((a, b) => a - b));
    return db
        .prepare(
            `
        WITH snapshot AS (
            SELECT client_id, is_active,
                (SELECT json_group_array(email_account_id) FROM (
                    SELECT email_account_id FROM mcp_client_accounts
                    WHERE mcp_client_id = ? ORDER BY email_account_id
                )) AS email_before,
                (SELECT json_group_array(email_account_id) FROM (
                    SELECT email_account_id FROM mcp_client_calendar_accounts
                    WHERE mcp_client_id = ? ORDER BY email_account_id
                )) AS calendar_before
            FROM mcp_clients WHERE id = ?
        )
        INSERT INTO audit_logs (client_id, action, target, details, success)
        SELECT client_id, ?, ?,
            json_object(
                'agent_id', ?, 'admin_user_id', ?,
                'before', json_object(
                    'email_account_ids', json(email_before),
                    'calendar_account_ids', json(calendar_before),
                    'is_active', is_active
                ),
                'after', json_object(
                    'email_account_ids', json(COALESCE(?, email_before)),
                    'calendar_account_ids', json(COALESCE(?, calendar_before)),
                    'is_active', CASE WHEN ? = 1 THEN 0 ELSE is_active END
                )
            ), 1
        FROM snapshot
    `
        )
        .bind(
            id,
            id,
            id,
            action,
            `agent:${id}`,
            id,
            userId ?? null,
            selection(emailIds),
            selection(calendarIds),
            action === 'agent_revoked' ? 1 : 0
        );
}
