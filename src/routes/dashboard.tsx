/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import type { Env } from '../types';
import { Layout, StatCard, Card, EmptyState } from '../views/layout';

const dashboard = new Hono<{ Bindings: Env; Variables: { userId: number; username: string } }>();

dashboard.get('/', async (c) => {
    const username = c.get('username');

    // Fetch stats
    const [accountsResult, agentsResult, auditResult, recentAudit] = await Promise.all([
        c.env.DB.prepare('SELECT COUNT(*) as count FROM email_accounts').first<{ count: number }>(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM mcp_clients WHERE is_active = 1').first<{ count: number }>(),
        c.env.DB.prepare('SELECT COUNT(*) as count FROM audit_logs').first<{ count: number }>(),
        c.env.DB.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5').all(),
    ]);

    const accountCount = accountsResult?.count ?? 0;
    const agentCount = agentsResult?.count ?? 0;
    const auditCount = auditResult?.count ?? 0;
    const recentLogs = recentAudit.results ?? [];

    return c.html(
        <Layout title="Dashboard" username={username} activeNav="dashboard">
            <div class="page-header">
                <div>
                    <h1 class="page-title">Dashboard</h1>
                    <p class="page-subtitle">Overview of your e-zer0 instance</p>
                </div>
            </div>

            <div class="stats-grid">
                <StatCard icon="📧" label="Email Accounts" value={accountCount} />
                <StatCard icon="🤖" label="Active Agents" value={agentCount} />
                <StatCard icon="📋" label="Total Audit Events" value={auditCount} />
            </div>

            <Card title="Recent Activity">
                {recentLogs.length === 0 ? (
                    <EmptyState
                        icon="🔇"
                        message="No activity yet. Connect an email account and an agent to get started."
                    />
                ) : (
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Agent</th>
                                    <th>Action</th>
                                    <th>Target</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentLogs.map((log: any) => (
                                    <tr>
                                        <td style="color:var(--text-muted); font-size:12px;">
                                            {new Date(log.created_at).toLocaleString()}
                                        </td>
                                        <td>{log.client_name || log.client_id}</td>
                                        <td>
                                            <span class="badge badge-active">{log.action}</span>
                                        </td>
                                        <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis;">
                                            {log.target || '—'}
                                        </td>
                                        <td>{log.success ? '✅' : '❌'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </Layout>
    );
});

export default dashboard;
