# OSS Scanner application

Andrew approved this application for submission on 21 October 2026. Enrolment
remains subject to Anthropic accepting the upstream application PR.

## Files to review

- `project.yaml`: ready to copy to `projects/e-zer0/project.yaml` in
  [`anthropics/oss-scanner`](https://github.com/anthropics/oss-scanner).
- `Dockerfile`: installs dependencies, runs type checks/tests and bundles the
  Worker without deployment; the checkout is at `/src`.
- `threat_model.md`: scan boundaries, priorities, offline reproduction guidance
  and report preferences.
- `../SECURITY.md`: public maintainer contact matching the application.
- `../.dockerignore`: excludes local secrets, state, dependencies and Git data
  from the container build context.

The public application and security policy will expose `nootn@hotmail.com` as
the security contact. Reports will use ordinary email; no PGP key is configured.
Acceptance is discretionary; this application makes no claim of broad adoption.

## Preparation checks, 21 October 2026

- Anthropic's current `tools/validate.py`: passed for the application config.
- `npm run check`: passed, including all 239 tests across 20 files.
- Linux Docker build: passed, including type checking, tests and Worker bundling.
- With `--network none`: type checking, all 239 tests and Worker bundling passed.
- Image checks: no local credential files, injected production keys or local
  database state; installed dependencies and the Worker bundle are present.
- New Markdown/YAML formatting and whitespace checks: passed.

These are preparation checks, not evidence of acceptance, a completed security
audit or live Cloudflare/provider behaviour. Recheck the published revision
before submission.

## Local validation

Run from the e-zer0 repository root:

```sh
docker build --progress=plain -f .oss-scanner/Dockerfile -t e-zer0-oss-scanner .
docker run --rm --network none e-zer0-oss-scanner sh -lc 'npm run lint && npm test && ./node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/e-zer0-worker'
```

The second command verifies that checks and bundling work after network access
is removed. It does not exercise real Cloudflare bindings or connected accounts.
Use `docker run --rm -it --network none e-zer0-oss-scanner` for offline inspection.

In a checkout of `anthropics/oss-scanner`, copy only `project.yaml` to
`projects/e-zer0/project.yaml`, then run `python tools/validate.py` (requires
PyYAML). The Dockerfile and threat model remain in this repository, as referenced
by the config. They must first be published on e-zer0's `main` branch so the
scanner can retrieve them.

## Upstream PR description

Title: **Enrol e-zer0 in OSS Scanner**

e-zer0 is an MIT-licensed, self-hosted Cloudflare Worker that connects MCP
clients to Gmail and Outlook/Microsoft 365, task services and read-only
calendars. It mediates access to OAuth credentials and private communications.
A vulnerability could expose provider tokens, bypass account permissions or
permit unauthorised mailbox operations, making it a security-sensitive boundary
between AI agents and users' accounts.

The project is small and actively maintained; we request consideration based on
that security role rather than claiming substantial adoption. I am Andrew Newton
(`nootn`), its maintainer, and the primary security contact is
`nootn@hotmail.com`, also documented in the repository's `SECURITY.md`.

The config points to a Dockerfile that prepares dependencies and bundles the
Worker for offline inspection, plus a threat model describing authentication,
per-account grants, token storage, untrusted content and provider mutations.
Testing uses synthetic data and mocks, without production credentials.

## Before submission, after approval

1. Review the [programme](https://red.anthropic.com/oss-scanner/) and
   [enrolment terms](https://red.anthropic.com/oss-scanner/terms/). Reports are
   AI-generated and may be wrong; proposed patches require maintainer review.
   Reports must be kept confidential and secure. Initially unvalidated reports
   have no automatic 90-day deadline; manually validated findings can enter
   Anthropic's coordinated disclosure process following notice.
2. Publish the reviewed preparation files to e-zer0 `main` and rerun the
   container/offline checks against that revision.
3. Copy the config into an oss-scanner fork, run its current validator and
   include the actual validation results in the upstream PR.
4. Open that PR only with Andrew's explicit approval. No fork, PR, email,
   deployment or enrolment is created by these preparation files.
