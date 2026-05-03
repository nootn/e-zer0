# Security scanning

Free, no-extra-account security baseline for `e-zer0`. All tooling runs locally
or in GitHub Actions — no SaaS signup required.

## What runs in CI

`.github/workflows/security.yml` runs on every PR, push to `main`, weekly
(Sunday 20:00 UTC), and on manual dispatch.

| Job            | Tool          | Purpose                                                |
| -------------- | ------------- | ------------------------------------------------------ |
| `quality`      | tsc, prettier, vitest | Format, typecheck, tests                       |
| `codeql`       | GitHub CodeQL | TypeScript/JavaScript static security analysis (see GHAS note below) |
| `semgrep`      | Semgrep OSS   | Pattern-based source scanning (TS/JS/Node/OWASP top10) |
| `dependencies` | npm audit + OSV Scanner | Known-CVE scanning across the dep tree       |
| `secrets`      | Gitleaks      | Secret scanning of full git history                    |
| `trivy`        | Trivy fs      | Filesystem + lockfile + IaC scan (HIGH/CRITICAL)       |

`.github/workflows/dast.yml` runs OWASP ZAP Baseline on demand against a
deployed URL (manual dispatch only).

## Local usage

Most scanners do not ship as npm dependencies. Install on demand:

```bash
# Repo-level checks (always available)
npm run typecheck
npm run format:check
npm test
npm run security:audit          # npm audit (runtime deps only)

# Requires global tools
npm run security:deps           # needs `osv-scanner` (https://github.com/google/osv-scanner)
npm run security:secrets        # needs `gitleaks`     (https://github.com/gitleaks/gitleaks)
npm run security:semgrep        # needs `semgrep`      (pip install semgrep)
npm run security:trivy          # needs `trivy`        (https://aquasecurity.github.io/trivy)
npm run security                # runs the lot
```

CI installs each scanner via official GitHub Actions, so you do **not** need
any of these locally to pass PR checks.

### Suggested install (macOS/Linux)

```bash
brew install osv-scanner gitleaks trivy semgrep
```

Windows: use `scoop install gitleaks trivy` and `pip install semgrep`. OSV
Scanner: download release binary from GitHub.

## Manual GitHub repo settings

These are GitHub-native — no extra accounts.

`Settings` → `Code security`:

- [ ] Enable Dependabot alerts
- [ ] Enable Dependabot security updates
- [ ] Enable secret scanning alerts
- [ ] Enable push protection for secrets

`Settings` → `Branches` → branch protection for `main`:

- [ ] Require a pull request before merging
- [ ] Require status checks before merging (select: `quality`, `codeql`,
      `semgrep`, `dependencies`, `secrets`, `trivy`)
- [ ] Require branches to be up to date before merging
- [ ] Disallow force pushes
- [ ] Require linear history (optional)

`Settings` → `Actions` → `General`:

- [ ] Restrict workflow permissions to read-only by default
- [ ] Require approval for first-time contributor workflow runs

## DAST / OWASP ZAP usage

The deployed Worker URL is the DAST target. Default: prefer a staging or
preview URL; do **not** scan a production URL aggressively without consent.

Steps:

1. Open the GitHub `Actions` tab.
2. Pick the `DAST` workflow.
3. Click `Run workflow`.
4. Enter the deployed Cloudflare URL (e.g. `https://e-zer0-staging.<account>.workers.dev`).
5. Wait for the baseline scan to complete.
6. Review the auto-created issue or workflow report.

Notes:

- Baseline scan is **unauthenticated**. The MCP routes behind login will not be
  reached. That is intentional for the no-secrets default.
- Authenticated DAST is a follow-up: would require a service-account session
  token stored as a GitHub secret and a custom ZAP context.
- Only scan URLs you own/control.

## Triage policy

### Block PRs on

- Confirmed secrets (Gitleaks, GitHub secret scanning)
- Failing typecheck or tests
- CRITICAL/HIGH dependency CVEs in runtime deps
- High-confidence CodeQL or Semgrep findings (ERROR severity)
- CRITICAL/HIGH Trivy findings affecting runtime/deployment

### Do not auto-block on

- LOW / MEDIUM findings without exploitability
- Dev-only dependency issues that do not affect runtime
- Confirmed false positives (document in risk register)
- Accepted risks with documented reasoning

When a finding is accepted rather than fixed, log it in
[`security-risk-register.md`](./security-risk-register.md).

## Cloudflare-specific watchlist

Specific to this Workers/Hono/D1/Vectorize stack:

- `wrangler.toml`, `.dev.vars`, `.env*` — never commit real secrets
  (`.dev.vars` is gitignored; `.dev.vars.example` is the template)
- Cloudflare API tokens stored only in GitHub Actions secrets
  (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) or the Cloudflare dashboard
- `app_settings` table holds encrypted OAuth credentials — never log decrypted
  values; see `src/lib/settings.ts`
- All MCP tool calls must invoke `logAudit()` on success and failure paths
- Email content must pass through `sanitizeEmailContent()` before being
  returned to AI agents (`src/lib/sanitizer.ts`)
- CORS / security headers — verify Hono response middleware on any new public
  routes
- No public debug/echo endpoints
- No source maps with sensitive comments shipped to production
- Cookies (if added) must be `Secure`, `HttpOnly`, `SameSite=Lax` or stricter

## CodeQL on private repositories

CodeQL needs **Code Scanning** enabled in repo settings. On a private repo
this requires GitHub Advanced Security (paid) or making the repo public
(free).

The `codeql` job is set to `continue-on-error: true` so it does not block
PRs while disabled. To enable:

1. Make the repository public, **or** turn on GHAS for the repo/org.
2. `Settings` → `Code security` → enable Code scanning (advanced setup,
   pointing at this workflow).
3. Remove `continue-on-error: true` from the `codeql` job in
   `.github/workflows/security.yml` so it becomes a required check.

Until then, Semgrep OSS provides static analysis coverage.

## Follow-ups not yet automated

- ESLint with `eslint-plugin-security` and `eslint-plugin-no-unsanitized` —
  the repo currently uses `tsc --noEmit` as its lint step. Adding ESLint is
  recommended but intentionally deferred to avoid invasive churn.
- Authenticated ZAP scans against the MCP-protected routes.
- Renovate or Dependabot config tuning for grouped dependency PRs.
