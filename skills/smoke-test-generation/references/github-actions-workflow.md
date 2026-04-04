# GitHub Actions CI Workflow Template

Complete annotated workflow for Household App Infrastructure apps. Blocks merges to main if tests fail.

## File Location

`.github/workflows/ci.yml`

## Full Template

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
    # Blocks merge to main if this workflow fails

# Cancel in-progress runs for the same branch (saves CI minutes)
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ──────────────────────────────────────────────
  # Job 1: Vitest (unit + integration tests)
  # ──────────────────────────────────────────────
  test-unit:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run Vitest
        run: npm run test -- --run --bail --reporter=github-actions
        env:
          # Supabase — use test project or mock values
          # Real values injected from GitHub Secrets — never hardcoded
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          # Add other required env vars here — values from Secrets, never hardcoded
          # Paid API keys are NOT needed here — MSW mocks all external calls

      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7

  # ──────────────────────────────────────────────
  # Job 2: Playwright (e2e tests)
  # ──────────────────────────────────────────────
  test-e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: test-unit  # Only run e2e if unit tests pass

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        id: playwright-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}

      - name: Install Playwright browsers
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium

      - name: Install Playwright deps (cached)
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium

      - name: Run Playwright tests
        run: npx playwright test
        env:
          CI: 'true'
          PLAYWRIGHT_BASE_URL: 'http://localhost:3000'
          # Test credentials — values from GitHub Secrets
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
          # App env vars
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

      - name: Upload Playwright traces
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: test-results/
          retention-days: 3
```

---

## Branch Protection Setup

After deploying this workflow, configure branch protection on `main` in GitHub:

1. Go to **Settings → Branches → Add rule**
2. Branch name pattern: `main`
3. Enable: **Require status checks to pass before merging**
4. Add required checks:
   - `Unit & Integration Tests`
   - `E2E Tests`
5. Enable: **Require branches to be up to date before merging**
6. Enable: **Do not allow bypassing the above settings** (optional but recommended)

---

## GitHub Secrets to Configure

Add these secrets in **Settings → Secrets and variables → Actions**:

| Secret Name | Description |
|---|---|
| `TEST_SUPABASE_URL` | Supabase URL for the test project |
| `TEST_SUPABASE_ANON_KEY` | Supabase anon key for the test project |
| `TEST_USER_EMAIL` | Email of test account for e2e tests |
| `TEST_USER_PASSWORD` | Password of test account for e2e tests |

**Note:** Paid API keys (Anthropic, Resend, etc.) are NOT added to CI secrets — MSW mocks intercept all paid API calls before they reach the network.

---

## Package.json Scripts

Ensure these scripts exist in `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui"
  }
}
```

---

## Workflow Optimisations

### Skip CI for Docs-Only Changes

```yaml
on:
  push:
    branches: [main]
    paths-ignore:
      - '**.md'
      - 'docs/**'
      - '.github/CODEOWNERS'
```

### Matrix Testing (Optional)

For apps that must support multiple Node versions:

```yaml
strategy:
  matrix:
    node-version: ['18', '20', '22']
steps:
  - uses: actions/setup-node@v4
    with:
      node-version: ${{ matrix.node-version }}
```

### Turbo Cache (Monorepo)

If the Household App Infrastructure infrastructure becomes a monorepo:

```yaml
- name: Install Turborepo
  run: npm install -g turbo

- name: Run tests
  run: turbo run test --filter={app-name}
```

---

## Debugging Failing CI

1. **Download the Playwright report artifact** — it contains screenshots and traces
2. **Check the Playwright trace** for the failing test: `npx playwright show-trace trace.zip`
3. **Re-run locally with CI env:** `CI=true npx playwright test`
4. **Run with headed mode:** `npx playwright test --headed` (local only)
