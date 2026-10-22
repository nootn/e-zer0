# Contributing to e-zer0

Thanks for helping improve e-zer0. We welcome contributions from new and
experienced contributors, including people trying it in their own deployments.

## Ways to help

- Report a bug with steps to reproduce it, what you expected and what happened.
- Improve documentation, setup instructions or examples.
- Add tests, fix bugs or improve accessibility and usability.
- Suggest or implement improvements to email, calendar, task or MCP support.

Search the [existing issues](https://github.com/nootn/e-zer0/issues) and
[pull requests](https://github.com/nootn/e-zer0/pulls) before starting. Small fixes
and documentation changes can go straight to a PR. For a larger feature or a
change to permissions, OAuth or stored data, open an issue first so we can agree
on the scope. If you are unsure where to start, ask in an issue; documentation
improvements and small bug fixes are useful first contributions.

## Forks are welcome

You are welcome to fork e-zer0, use it for your own needs and share improvements.
You do not have to contribute changes back, but PRs that could help other users
are encouraged. Forks and contributions follow the repository's
[MIT licence](LICENSE); retain the required copyright and licence notices.

## Make a change

Use Node.js 22, matching the project's CI. Fork the repository on GitHub, then
clone your fork and create a branch. Replace `YOUR-USERNAME` below with your
GitHub username:

```sh
git clone https://github.com/YOUR-USERNAME/e-zer0.git
cd e-zer0
git checkout -b my-change
npm ci
npm run check
```

The checks run with mocked services and do not require Cloudflare credentials
or a connected mailbox. `npm run check` formats files, checks TypeScript and runs
the Vitest suite. Review any formatting changes before committing.

For local UI development, copy `.dev.vars.example` to `.dev.vars` and replace
both key placeholders with separate random values, using the instructions in
the example. Then run:

```sh
npm run db:migrate:local
npm run dev
```

Keep `.dev.vars` private. Provider integration testing needs your own test
accounts; use synthetic messages and data. Workers AI and Vectorize are not
available through local emulation, so use the existing mocks for tests.
`npm run setup-cf`, deployment and remote migration commands change Cloudflare
resources; they are not needed to run the checks above.

Read the [developer onboarding guide](docs/developer-onboarding.md) for the
architecture and the [coding conventions](AGENTS.md) before changing application
code. Keep changes focused, reuse the existing provider abstractions, and retain
account permission checks, content sanitisation and audit logging. The app runs
on Cloudflare Workers; Node.js is used for development tooling and tests.

## Open a pull request

1. Make your change on a branch in your fork. Add or update tests when behaviour
   changes, and update affected documentation.
2. Run `npm run check` and review the diff. Keep unrelated changes out of the PR.
3. Push your branch and open a PR against `nootn/e-zer0`'s `main` branch. Draft PRs
   are welcome if you want feedback while working.
4. Explain the problem, what changed and how you tested it. For UI changes,
   screenshots with synthetic data help reviewers understand the result. Note
   anything you could not verify, such as a provider-specific flow.

Please keep discussions respectful and constructive. Questions and feedback on
the contribution process are welcome too.

## Security and private data

Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md).
Keep unpatched vulnerability details out of public issues and PRs. Never include
real email content, passwords, OAuth tokens, credentials or private database
files in a contribution, screenshot or log; use synthetic examples instead.
