# UmrFlix Playwright E2E & Penpot Visual Testing Suite

Production-grade End-to-End (E2E) and Visual Verification framework for **UmrFlix**, configured for Next.js 16 App Router and tailored for LLMs and developers working on the application-wide UI refresh.

---

## Quick Start

### 1. Run Live Server E2E Tests
Runs all functional test suites against the live running Next.js application:
```bash
npm run test:e2e
```

### 2. Interactive UI Mode
Opens Playwright's interactive browser debugger and test runner:
```bash
npm run test:e2e:ui
```

### 3. Interactive LLM Penpot Verification CLI
Whenever an LLM or developer modifies a UI component or page, run this command to inspect and verify the visual output against the Penpot design file:
```bash
# Verify a specific component / page
npm run penpot:verify -- --target login
npm run penpot:verify -- --target header
npm run penpot:verify -- --target hero
npm run penpot:verify -- --target home
npm run penpot:verify -- --target search-results

# Verify all design targets
npm run penpot:verify -- --all

# Update reference baselines with latest live renders
npm run penpot:verify -- --all --update-baselines
```

### 4. Run Penpot Visual Regression Tests
```bash
npm run test:visual
```

---

## Architecture & Directory Structure

```
e2e/
├── .auth/                  # Persisted live browser session cookies (user.json)
├── .report/                # Playwright HTML test reports
├── .results/               # Playwright test execution artifacts & failure traces
├── fixtures/
│   └── test-base.ts        # Custom Playwright fixtures (token inspection, motion disable)
├── mocks/
│   └── mock-data.ts        # Penpot-aligned media & catalog fixtures
├── setup/
│   └── auth.setup.ts       # Global live server authentication handshake
├── visual/
│   ├── baselines/          # Reference baseline PNGs (from Penpot design boards)
│   ├── diffs/              # Generated pixel diff overlays (.actual.png, .diff.png)
│   ├── penpot-manifest.json# Manifest connecting Penpot Board IDs -> Routes -> Baselines
│   └── penpot-visual.spec.ts # Automated visual regression spec
├── auth.spec.ts            # Live /login page flows & validation
├── catalog.spec.ts         # Live Movies, TV Shows, and Library browsing
├── details.spec.ts         # Live Movie/TV details, seasons, episodes, and requests
├── home.spec.ts            # Live Home page (Hero billboard, carousels, modals)
├── player.spec.ts          # Live CinemaPlayer HUD, seekbar, and overlays
├── search.spec.ts          # Live search auto-suggest & full search results
└── touch-responsive.spec.ts# Mobile (390px) & Tablet (768px) responsive layouts
```

---

## Design Token Conformance

UmrFlix uses Tailwind CSS v4 design tokens defined in `src/app/globals.css`. When modifying components:
- Background surfaces: `bg-penpot-bg`, `bg-penpot-surface`, `bg-grey-900` (`#141414`)
- Primary accents: `text-penpot-primary`, `bg-primary-red` (`#E50914`)
- Typography: `font-sans` ('Satoshi', system-ui)
- Translucent overlays: `bg-trans-white-15`, `bg-trans-black-60`

The interactive verification script (`scripts/penpot-verify.ts`) automatically evaluates computed CSS against these design tokens and flags deviations.
