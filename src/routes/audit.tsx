/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env, AuditLog } from '../types';
import { Layout, Card, EmptyState } from '../views/layout';

const audit = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

const PAGE_SIZE = 25;

audit.get('/', async (c) => {
    const username = c.get('username');
    const page = parseInt(c.req.query('page') || '1');
    const offset = (page - 1) * PAGE_SIZE;

    const [logsResult, countResult] = await Promise.all([
        c.env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?')
            .bind(PAGE_SIZE, offset)
            .all<AuditLog>(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM audit_logs').first<{ count: number }>(),
    ]);

    const logs = logsResult.results ?? [];
    const totalCount = countResult?.count ?? 0;
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);

    return c.html(
        <Layout title="Audit Log" username={username} activeNav="audit">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Audit Log</h1>
                    <p class="page-subtitle">Every action taken by agents is recorded here</p>
                </div>
                <div style="color:var(--text-muted); font-size:13px;">{totalCount} total events</div>
            </div>

            {logs.length === 0 ? (
                <Card>
                    <EmptyState
                        icon="📋"
                        message="No audit events recorded yet. Events will appear here when agents use MCP tools."
                    />
                </Card>
            ) : (
                <Card>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Timestamp</th>
                                    <th>Agent</th>
                                    <th>Action</th>
                                    <th>Target</th>
                                    <th>Details</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log) => (
                                    <tr>
                                        <td style="color:var(--text-muted); font-size:12px; white-space:nowrap;">
                                            {new Date(log.created_at).toLocaleString()}
                                        </td>
                                        <td style="font-weight:500;">{log.client_name || log.client_id}</td>
                                        <td>
                                            <span class="badge badge-active">{log.action}</span>
                                        </td>
                                        <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                            {log.target || '—'}
                                        </td>
                                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary); font-size:13px;">
                                            {log.details || '—'}
                                        </td>
                                        <td>
                                            {log.success ? (
                                                <span style="color:var(--success);">✅</span>
                                            ) : (
                                                <span
                                                    title={log.error_message || ''}
                                                    style="color:var(--error); cursor:help;"
                                                >
                                                    ❌
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {totalPages > 1 && (
                        <div style="display:flex; justify-content:center; gap:8px; margin-top:20px;">
                            {page > 1 && (
                                <a href={`/audit?page=${page - 1}`} class="btn btn-ghost btn-sm">
                                    ← Previous
                                </a>
                            )}
                            <span style="padding:6px 12px; color:var(--text-muted); font-size:13px;">
                                Page {page} of {totalPages}
                            </span>
                            {page < totalPages && (
                                <a href={`/audit?page=${page + 1}`} class="btn btn-ghost btn-sm">
                                    Next →
                                </a>
                            )}
                        </div>
                    )}
                </Card>
            )}
        </Layout>
    );
});

export default audit;
