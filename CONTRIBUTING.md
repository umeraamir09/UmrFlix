# Contributing

Thanks for your interest in improving UmrFlix. Contributions that fix bugs, improve the experience, strengthen tests, or clarify documentation are welcome.

**Suggested coordination, not an approval gate:** For substantial or user-visible changes, consider opening an issue or discussion before significant work begins so the approach can be discussed. The repository does not document an issue-first requirement or contribution-approval policy.

## Set up a local checkout

The project uses Node.js (20 or newer) and npm. From a terminal:

```bash
git clone https://github.com/umeraamir09/UmrFlix.git
cd UmrFlix
npm ci
```

To run the full application locally, copy `.env.example` to `.env.local` and configure the services you use:

```bash
cp .env.example .env.local
npm run dev
```

Keep real credentials in your local environment only. Never commit `.env.local`, API keys, passwords, tokens, or other secrets. Backend credentials must remain server-side; document any new environment variables in the README and `.env.example` as appropriate.

## Checks

Run the checks relevant to your change before opening a pull request. The main offline checks, also used by GitHub Actions, are:

```bash
npm run lint
npx tsc --noEmit
npm run test:party
npm run test:discovery
npm run test:lib
npm run test:components
npm run build
```

For changes to end-to-end behavior, the project also provides `npm run test:e2e`. Those Playwright tests use the configured live application and authentication setup; they may require working Jellyfin, Radarr, Sonarr, TMDB proxy, and local environment values. UI changes can be checked with `npm run penpot:verify -- --target <target>` when the Penpot verification setup is available. Do not update visual baselines unless the design change is intentional and approved.

You do not need to run every environment-dependent suite for an unrelated documentation-only change. In your pull request, say which checks you ran and note any relevant check you could not run.

## Project conventions

Please follow the existing patterns in the codebase and the repository's `AGENTS.md` guidance. In particular:

- Keep third-party credentials and external service access on the server side; use the shared environment helper and existing route/library structure.
- Follow the existing Next.js App Router, TypeScript, Tailwind CSS v4 design-token, and shared UI-component patterns rather than introducing a parallel framework or styling system.
- Add or update tests when changing behavior, and update user-facing documentation when configuration or setup changes.
- Keep changes focused and avoid unrelated formatting or generated-file churn.

There is no repository formatter script or documented lint-fix command; `npm run lint` is the configured ESLint check.

## Pull requests

Please make each pull request focused and reviewable. Include:

- The problem being addressed and a short explanation of the solution.
- Any user-visible behavior or environment/configuration changes.
- The tests and checks you ran, plus known limitations.
- Screenshots or a short recording for material UI changes, when useful.

Before submitting, check that no credentials or local environment files are included and that the PR description matches the actual diff.

### Draft workflow suggestion — not an established requirement

No branch-name or commit-message convention is documented in the repository. As an optional starting point for maintainer review, contributors could use short branch names such as `fix/<topic>`, `feat/<topic>`, or `docs/<topic>` and concise imperative commit subjects. This is a suggestion only, not a project requirement unless maintainers choose to adopt it.
