# Contributing

Welcome to UmrFlix. Contributions that fix bugs, improve the experience, strengthen tests, or clarify documentation are welcome. This guide explains how to get started, choose relevant checks, and prepare a pull request.

## Quick links

- **Project overview and setup:** [README.md](README.md)
- **Bug reports:** [Bug report form](.github/ISSUE_TEMPLATE/bug_report.yml)
- **Feature ideas:** [Feature request form](.github/ISSUE_TEMPLATE/feature_request.yml)
- **Pull requests:** [Pull request template](.github/PULL_REQUEST_TEMPLATE.md)
- **Development conventions:** [AGENTS.md](AGENTS.md)
- **Project roadmap:** [specs/roadmap.md](specs/roadmap.md)
- **Community expectations:** [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **License:** [LICENSE](LICENSE)

## How to contribute

Choose the path that best fits your change:

1. **Report a bug** — Use the [bug report form](.github/ISSUE_TEMPLATE/bug_report.yml). Include the shortest reliable reproduction steps, what you expected, what happened, and relevant environment details. Redact credentials, private server addresses, and personal information from logs or screenshots.
2. **Suggest a feature** — Use the [feature request form](.github/ISSUE_TEMPLATE/feature_request.yml) to describe the user problem and the outcome you have in mind. Alternatives, examples, and screenshots are optional context.
3. **Improve documentation or code** — Open a pull request with a focused change. For substantial or user-visible work, consider opening an issue first to discuss the scope, but the repository does not document an issue-first or assignment requirement. Blank issues are enabled if an existing form does not fit.
4. **Raise a community-conduct concern** — Follow the contact instructions in the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up your checkout

UmrFlix uses Node.js 20 or newer and npm. From a terminal:

```bash
git clone https://github.com/umeraamir09/UmrFlix.git
cd UmrFlix
npm ci
```

To run the application locally, create a local environment file and configure the services you need. See [`.env.example`](.env.example) and the environment-variable descriptions in the [README](README.md):

```bash
cp .env.example .env.local
npm run dev
```

Keep real credentials in your local environment only. Do not commit `.env.local`, API keys, passwords, tokens, or other secrets. External-service credentials must remain server-side. If your change adds an environment variable, update the README and `.env.example` where appropriate.

## Development workflow

1. **Choose a focused change.** Review the relevant code and existing conventions in [AGENTS.md](AGENTS.md). For larger or user-visible work, an issue can be useful for discussing scope before implementation.
2. **Create a branch.** Use any clear branch name; the repository does not define a required naming convention.
3. **Implement the change.** Keep the diff focused and follow the existing application structure.
4. **Test what changed.** Add or update tests when behavior changes, and run the checks that fit your change. See [Checks](#checks).
5. **Open a pull request.** Use the repository’s [PR template](.github/PULL_REQUEST_TEMPLATE.md), describe the change and its impact, and report the checks you ran and any relevant limitations.
6. **Respond to review.** Update the pull request as needed and keep its description aligned with the final diff.

### Where code belongs

The project is a Next.js App Router application written in TypeScript. Follow the established layout:

- `src/app/**` — pages, layouts, and API route handlers
- `src/components/**` — reusable and page-level UI
- `src/lib/**` — shared logic and external-service helpers
- `src/components/ui/**` — shared UI primitives

Keep external-service access and credentials on the server side. Use the shared environment helper in `src/lib/env.ts` for environment variables. For UI work, follow the Tailwind CSS v4 design tokens in `src/app/globals.css` and reuse existing UI patterns rather than adding a parallel styling system. See [AGENTS.md](AGENTS.md) for more detailed conventions, including player-specific guidance.

## Checks

Run the checks relevant to your change. The GitHub Actions workflow runs the following checks for pull requests and pushes to `main`:

```bash
npm run lint
npx tsc --noEmit
npm run test:party
npm run test:discovery
npm run test:lib
npm run test:components
npm run build
```

The project also provides checks for live application behavior and visual changes:

```bash
npm run test:e2e
npm run test:visual
npm run penpot:verify -- --target <target>
```

Playwright end-to-end tests exercise the configured application and authentication setup; depending on the test, they may need local environment values and working integrations. Penpot verification requires its setup to be available. See [`e2e/README.md`](e2e/README.md) for the test suite and `AGENTS.md` for the UI verification workflow. Refresh visual baselines only for an approved design change.

You do not need to run environment-dependent suites for an unrelated documentation-only change. In the PR, state which relevant checks you ran and note any important check you could not run.

## Pull request guidelines

Keep each pull request focused and reviewable. The [PR template](.github/PULL_REQUEST_TEMPLATE.md) asks you to provide:

- **Summary:** The problem and the change that addresses it.
- **User-visible or configuration changes:** Note behavior, setup, or environment changes, or say “None.”
- **Validation:** List relevant checks and outcomes, including checks not run and why.

Before opening the PR, review the diff and check that:

- Behavior changes have appropriate tests, or testing is not applicable.
- User-facing documentation and environment examples are updated when needed.
- No credentials, tokens, or local environment files are included.
- Material UI changes include screenshots or a recording when useful.
- The PR description accurately reflects the changes.

## Need help?

Check the [README](README.md), [development conventions](AGENTS.md), and relevant documentation first. For a bug or feature suggestion, use the matching issue form linked above. For community-conduct concerns, use the contact listed in the [Code of Conduct](CODE_OF_CONDUCT.md).
