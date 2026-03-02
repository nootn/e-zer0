/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { html, raw } from 'hono/html';

interface LayoutProps {
    title: string;
    children: any;
    username?: string;
    activeNav?: string;
}

export const Layout: FC<LayoutProps> = ({ title, children, username, activeNav }) => {
    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>{title} — e-zer0</title>
                <meta name="description" content="AI-Native Inbox Manager — secure MCP bridge to your email" />
                {html`
                    <link rel="preconnect" href="https://fonts.googleapis.com" />
                    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
                    <link
                        href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
                        rel="stylesheet"
                    />
                    <style>
                        ${raw(css)}
                    </style>
                `}
            </head>
            <body>
                {username ? (
                    <div class="app-shell">
                        <nav class="sidebar">
                            <div class="sidebar-header">
                                <div class="logo">
                                    <span class="logo-icon">⚡</span>
                                    <span class="logo-text">e-zer0</span>
                                </div>
                            </div>
                            <div class="nav-links">
                                <a href="/dashboard" class={`nav-link ${activeNav === 'dashboard' ? 'active' : ''}`}>
                                    <span class="nav-icon">📊</span> Dashboard
                                </a>
                                <a href="/accounts" class={`nav-link ${activeNav === 'accounts' ? 'active' : ''}`}>
                                    <span class="nav-icon">📧</span> Email Accounts
                                </a>
                                <a href="/agents" class={`nav-link ${activeNav === 'agents' ? 'active' : ''}`}>
                                    <span class="nav-icon">🤖</span> Agents
                                </a>
                                <a href="/audit" class={`nav-link ${activeNav === 'audit' ? 'active' : ''}`}>
                                    <span class="nav-icon">📋</span> Audit Log
                                </a>
                                <a href="/settings" class={`nav-link ${activeNav === 'settings' ? 'active' : ''}`}>
                                    <span class="nav-icon">⚙️</span> Settings
                                </a>
                            </div>
                            <div class="sidebar-footer">
                                <div class="user-info">
                                    <span class="user-avatar">👤</span>
                                    <span class="user-name">{username}</span>
                                </div>
                                <form method="post" action="/logout" style="margin:0">
                                    <button type="submit" class="btn btn-ghost btn-sm">
                                        Logout
                                    </button>
                                </form>
                            </div>
                        </nav>
                        <main class="main-content">
                            <div class="page-container">{children}</div>
                        </main>
                    </div>
                ) : (
                    <div class="auth-shell">
                        <div class="auth-container">
                            <div class="auth-header">
                                <span class="logo-icon-lg">⚡</span>
                                <h1 class="auth-title">e-zer0</h1>
                                <p class="auth-subtitle">AI-Native Inbox Manager</p>
                            </div>
                            {children}
                        </div>
                    </div>
                )}
            </body>
        </html>
    );
};

// ── Shared Components ───────────────────────────────────

export const Card: FC<{ title?: string; children: any; class?: string }> = ({ title, children, class: className }) => (
    <div class={`card ${className || ''}`}>
        {title && <h3 class="card-title">{title}</h3>}
        {children}
    </div>
);

export const Alert: FC<{ type: 'success' | 'error' | 'warning' | 'info'; children: any }> = ({ type, children }) => (
    <div class={`alert alert-${type}`}>{children}</div>
);

export const StatCard: FC<{ label: string; value: string | number; icon: string }> = ({ label, value, icon }) => (
    <div class="stat-card">
        <div class="stat-icon">{icon}</div>
        <div class="stat-body">
            <div class="stat-value">{value}</div>
            <div class="stat-label">{label}</div>
        </div>
    </div>
);

export const EmptyState: FC<{ icon: string; message: string; action?: any }> = ({ icon, message, action }) => (
    <div class="empty-state">
        <div class="empty-icon">{icon}</div>
        <p class="empty-message">{message}</p>
        {action}
    </div>
);

// ── CSS ─────────────────────────────────────────────────

const css = `
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 300; font-display: swap; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuOKfMZg.ttf) format('truetype'); }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; font-display: swap; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf) format('truetype'); }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 500; font-display: swap; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuI6fMZg.ttf) format('truetype'); }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 600; font-display: swap; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf) format('truetype'); }
  @font-face { font-family: 'Inter'; font-style: normal; font-weight: 700; font-display: swap; src: url(https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf) format('truetype'); }

  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  :root {
    --bg-primary: #0a0e17;
    --bg-secondary: #111827;
    --bg-card: #1a2035;
    --bg-card-hover: #1f2847;
    --bg-input: #0f1629;
    --border: #2a3452;
    --border-focus: #6366f1;
    --text-primary: #f1f5f9;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --accent: #6366f1;
    --accent-hover: #818cf8;
    --accent-glow: rgba(99, 102, 241, 0.15);
    --success: #22c55e;
    --error: #ef4444;
    --warning: #f59e0b;
    --info: #3b82f6;
    --radius: 10px;
    --radius-sm: 6px;
    --shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
    --transition: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg-primary);
    color: var(--text-primary);
    line-height: 1.6;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  /* ── App Shell ───────────────────────────────── */
  .app-shell { display: flex; min-height: 100vh; }

  .sidebar {
    width: 260px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0; left: 0; bottom: 0;
    z-index: 100;
  }

  .sidebar-header { padding: 24px 20px; border-bottom: 1px solid var(--border); }

  .logo { display: flex; align-items: center; gap: 10px; }
  .logo-icon { font-size: 24px; }
  .logo-text { font-size: 20px; font-weight: 700; letter-spacing: -0.5px; background: linear-gradient(135deg, var(--accent), var(--accent-hover)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

  .nav-links { flex: 1; padding: 12px 8px; display: flex; flex-direction: column; gap: 2px; }

  .nav-link {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 14px; border-radius: var(--radius-sm);
    color: var(--text-secondary); text-decoration: none;
    font-size: 14px; font-weight: 500;
    transition: all var(--transition);
  }
  .nav-link:hover { background: var(--accent-glow); color: var(--text-primary); }
  .nav-link.active { background: var(--accent-glow); color: var(--accent-hover); border-left: 3px solid var(--accent); }
  .nav-icon { font-size: 16px; width: 24px; text-align: center; }

  .sidebar-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
  }
  .user-info { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); }
  .user-avatar { font-size: 18px; }
  .user-name { font-weight: 500; }

  .main-content { margin-left: 260px; flex: 1; min-height: 100vh; }
  .page-container { padding: 32px 40px; max-width: 1200px; }

  /* ── Auth Shell ──────────────────────────────── */
  .auth-shell {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.08) 0%, transparent 60%), var(--bg-primary);
  }
  .auth-container { width: 100%; max-width: 420px; padding: 24px; }
  .auth-header { text-align: center; margin-bottom: 32px; }
  .logo-icon-lg { font-size: 48px; display: block; margin-bottom: 12px; }
  .auth-title { font-size: 28px; font-weight: 700; letter-spacing: -1px; background: linear-gradient(135deg, var(--accent), var(--accent-hover)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  .auth-subtitle { color: var(--text-muted); font-size: 14px; margin-top: 6px; }

  /* ── Cards ───────────────────────────────────── */
  .card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    box-shadow: var(--shadow);
    transition: border-color var(--transition);
  }
  .card:hover { border-color: rgba(99,102,241,0.25); }
  .card-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: var(--text-primary); }

  .stat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px 24px;
    display: flex; align-items: center; gap: 16px;
    box-shadow: var(--shadow);
    transition: all var(--transition);
  }
  .stat-card:hover { border-color: rgba(99,102,241,0.3); transform: translateY(-2px); }
  .stat-icon { font-size: 28px; }
  .stat-value { font-size: 28px; font-weight: 700; letter-spacing: -1px; }
  .stat-label { font-size: 13px; color: var(--text-muted); margin-top: 2px; }

  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }

  /* ── Forms ───────────────────────────────────── */
  .form-group { margin-bottom: 20px; }
  .form-label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
  .form-input {
    width: 100%; padding: 10px 14px;
    background: var(--bg-input); border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text-primary);
    font-size: 14px; font-family: inherit;
    transition: all var(--transition);
    outline: none;
  }
  .form-input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--accent-glow); }

  /* ── Buttons ─────────────────────────────────── */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 10px 20px; border: none; border-radius: var(--radius-sm);
    font-size: 14px; font-weight: 600; font-family: inherit;
    cursor: pointer; transition: all var(--transition);
    text-decoration: none;
  }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover { background: var(--accent-hover); box-shadow: 0 4px 16px rgba(99,102,241,0.3); transform: translateY(-1px); }
  .btn-danger { background: var(--error); color: white; }
  .btn-danger:hover { background: #dc2626; }
  .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid var(--border); }
  .btn-ghost:hover { background: var(--bg-card); color: var(--text-primary); border-color: var(--text-muted); }
  .btn-sm { padding: 6px 12px; font-size: 12px; }
  .btn-full { width: 100%; }

  /* ── Tables ──────────────────────────────────── */
  .table-container { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  thead th {
    text-align: left; padding: 10px 16px;
    font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--text-muted); border-bottom: 1px solid var(--border);
  }
  tbody td {
    padding: 12px 16px; font-size: 14px;
    border-bottom: 1px solid rgba(42,52,82,0.5);
  }
  tbody tr { transition: background var(--transition); }
  tbody tr:hover { background: rgba(99,102,241,0.04); }

  /* ── Alerts ──────────────────────────────────── */
  .alert {
    padding: 12px 16px; border-radius: var(--radius-sm);
    font-size: 14px; margin-bottom: 20px;
    border-left: 4px solid;
  }
  .alert-success { background: rgba(34,197,94,0.1); border-color: var(--success); color: var(--success); }
  .alert-error { background: rgba(239,68,68,0.1); border-color: var(--error); color: var(--error); }
  .alert-warning { background: rgba(245,158,11,0.1); border-color: var(--warning); color: var(--warning); }
  .alert-info { background: rgba(59,130,246,0.1); border-color: var(--info); color: var(--info); }

  /* ── Status Badges ──────────────────────────── */
  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 100px;
    font-size: 12px; font-weight: 600;
  }
  .badge-active { background: rgba(34,197,94,0.15); color: var(--success); }
  .badge-expired { background: rgba(239,68,68,0.15); color: var(--error); }
  .badge-error { background: rgba(239,68,68,0.15); color: var(--error); }
  .badge-revoked { background: rgba(100,116,139,0.15); color: var(--text-muted); }

  /* ── Empty State ─────────────────────────────── */
  .empty-state { text-align: center; padding: 48px 24px; }
  .empty-icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
  .empty-message { color: var(--text-muted); font-size: 15px; margin-bottom: 20px; }

  /* ── Code / Token Display ────────────────────── */
  .code-block {
    background: var(--bg-input); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 12px 16px;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 13px; word-break: break-all;
    color: var(--accent-hover);
  }

  /* ── Page Headers ────────────────────────────── */
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
  .page-title { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
  .page-subtitle { font-size: 14px; color: var(--text-muted); margin-top: 4px; }

  /* ── Responsive ──────────────────────────────── */
  @media (max-width: 768px) {
    .sidebar { width: 100%; height: auto; position: relative; border-right: none; border-bottom: 1px solid var(--border); }
    .app-shell { flex-direction: column; }
    .main-content { margin-left: 0; }
    .page-container { padding: 20px; }
    .nav-links { flex-direction: row; overflow-x: auto; padding: 8px; }
    .sidebar-footer { display: none; }
    .stats-grid { grid-template-columns: 1fr; }
  }

  /* ── Animations ──────────────────────────────── */
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .card, .stat-card, .auth-container { animation: fadeIn 0.4s ease-out; }
`;
