---
name: smoke-test-generation
description: This skill should be used when the user asks to "generate smoke tests", "add tests", "write a CI workflow", "set up testing", "add Playwright tests", "add Vitest tests", or wants to ensure a Household App Infrastructure app has basic test coverage and CI protection. Reads existing app code, infers critical user journeys, and writes Vitest unit/integration tests plus Playwright end-to-end tests with a GitHub Actions workflow that blocks merges to main on failure.
version: 1.0.0
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# Smoke Test Generation

Reads a Household App Infrastructure app's code, infers the critical user journeys, and generates a complete test suite: Vitest for unit and API-level tests, Playwright for end-to-end browser flows, and a GitHub Actions CI workflow that blocks merges to main if any test fails. All paid API calls (Anthropic, Resend, etc.) are mocked so the test suite never incurs costs.

## When This Skill Applies

Activate when the user:
- Asks to generate or add tests for an app
- Wants CI protection on their main branch
- Asks to mock paid API calls in tests
- Wants to infer test coverage from existing code

---

## Step 1 — Discover App Structure

Before writing any test, scan the app to understand what it does.

### Identify Framework and Entry Points

```
Glob: app/**/*.tsx          → Next.js App Router pages
Glob: pages/**/*.tsx        → Next.js Pages Router
Glob: app/api/**/*.ts       → API route handlers
Glob: pages/api/**/*.ts     → API route handlers (pages router)
Glob: src/**/*.tsx          → Non-Next.js React app
```

### Identify External Service Integrations

```
Grep: from '@anthropic-ai/sdk'    → Anthropic LLM calls
Grep: from 'anthropic'            → Anthropic LLM calls
Grep: from 'resend'               → Resend email sending
Grep: from 'openai'               → OpenAI API calls
Grep: supabase\.from\(            → Supabase database calls
Grep: stripe\.                    → Stripe payment calls
Grep: fetch\(                     → Raw HTTP calls to external services
```

Record every external service found — each needs a mock.

### Identify Critical User Journeys

See `references/journey-inference.md` for full inference patterns. In brief:

1. **Route handlers** → each `app/api/*/route.ts` is a potential journey endpoint
2. **Page components** → pages with forms or data fetching are journey entry points
3. **Auth flows** → any reference to `supabase.auth`, `signIn`, `signOut`
4. **Data mutation flows** → any `INSERT`, `UPDATE`, `DELETE` via Supabase
5. **LLM interaction flows** → any call to Anthropic/OpenAI that is user-triggered

Prioritise journeys by impact:
1. Auth (sign in / sign out)
2. Core data creation (the main thing the app does)
3. Core data retrieval (reading/displaying data)
4. AI-powered flows (LLM calls)
5. Email/notification flows

---

## Step 2 — Set Up Test Infrastructure

### Install Dependencies

Check `package.json` first to avoid reinstalling existing packages:

```bash
# Check what's already installed
EXISTING=$(cat package.json | jq -r '.devDependencies | keys[]' 2>/dev/null)

VITEST_NEEDED=true
PLAYWRIGHT_NEEDED=true

echo "$EXISTING" | grep -q vitest && VITEST_NEEDED=false
echo "$EXISTING" | grep -q playwright && PLAYWRIGHT_NEEDED=false
```

Generate the install command for only what's missing:

```bash
INSTALL_PKGS=""
$VITEST_NEEDED && INSTALL_PKGS="$INSTALL_PKGS vitest @vitest/coverage-v8 @vitejs/plugin-react"
$PLAYWRIGHT_NEEDED && INSTALL_PKGS="$INSTALL_PKGS @playwright/test"

# Always include test utilities if missing
echo "$EXISTING" | grep -q "@testing-library/react" || INSTALL_PKGS="$INSTALL_PKGS @testing-library/react @testing-library/user-event"
echo "$EXISTING" | grep -q "msw" || INSTALL_PKGS="$INSTALL_PKGS msw"

echo "Run: npm install -D $INSTALL_PKGS"
```

### Vitest Config

Generate `vitest.config.ts` if it doesn't exist:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '.next/', 'tests/', '*.config.*'],
    },
  },
})
```

### Playwright Config

Generate `playwright.config.ts` if it doesn't exist:

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

### Test Setup File

Generate `tests/setup.ts`:

```typescript
// tests/setup.ts
import { afterEach, beforeAll, afterAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './mocks/server'

// Start MSW mock server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))

// Reset handlers after each test
afterEach(() => {
  cleanup()
  server.resetHandlers()
})

// Clean up after all tests
afterAll(() => server.close())
```

---

## Step 3 — Generate API Mocks

For every paid external service found in Step 1, generate an MSW mock handler. **Tests must never call real paid APIs.**

See `references/api-mock-patterns.md` for complete mock templates.

### Mock Server Entry Point

Generate `tests/mocks/server.ts`:

```typescript
// tests/mocks/server.ts
import { setupServer } from 'msw/node'
import { anthropicHandlers } from './handlers/anthropic'
import { resendHandlers } from './handlers/resend'
// Import additional handlers as needed

export const server = setupServer(
  ...anthropicHandlers,
  ...resendHandlers,
)
```

### Anthropic Mock

Generate `tests/mocks/handlers/anthropic.ts` if Anthropic is used — see `references/api-mock-patterns.md`.

### Resend Mock

Generate `tests/mocks/handlers/resend.ts` if Resend is used — see `references/api-mock-patterns.md`.

---

## Step 4 — Generate Vitest Unit/Integration Tests

For each critical user journey identified in Step 1, generate one test file.

### File Naming Convention

```
tests/unit/         → Pure function and utility tests
tests/integration/  → API route handler tests
tests/e2e/          → Playwright browser tests
```

### API Route Handler Test Pattern

```typescript
// tests/integration/api/{route-name}.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockRequest } from '../helpers/request'

// Mock Supabase — never hit real database in unit/integration tests
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    schema: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(),
  },
}))

import { supabase } from '@/lib/supabase/client'
import { GET, POST } from '@/app/api/{route}/route'

describe('{Route} API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET', () => {
    it('returns data for authenticated user', async () => {
      const mockData = [{ id: 'test-uuid', /* ... */ }]
      vi.mocked(supabase.select).mockResolvedValueOnce({ data: mockData, error: null })

      const req = createMockRequest({ method: 'GET' })
      const res = await GET(req)
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual(mockData)
    })

    it('returns 401 when unauthenticated', async () => {
      // Mock auth.getUser returning null
      const req = createMockRequest({ method: 'GET', authenticated: false })
      const res = await GET(req)
      expect(res.status).toBe(401)
    })

    it('returns 500 on database error', async () => {
      vi.mocked(supabase.select).mockResolvedValueOnce({
        data: null,
        error: { message: 'DB error', code: 'PGRST000' },
      })
      const req = createMockRequest({ method: 'GET' })
      const res = await GET(req)
      expect(res.status).toBe(500)
    })
  })
})
```

### Request Helper

Generate `tests/helpers/request.ts`:

```typescript
// tests/helpers/request.ts
export function createMockRequest(options: {
  method?: string
  body?: unknown
  params?: Record<string, string>
  authenticated?: boolean
  userId?: string
}): Request {
  const {
    method = 'GET',
    body,
    params = {},
    authenticated = true,
    userId = 'test-user-id',
  } = options

  const url = new URL('http://localhost/api/test')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // Mock auth header — never use real credentials in tests
      ...(authenticated ? { Authorization: `Bearer test-token-${userId}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}
```

---

## Step 5 — Generate Playwright E2E Tests

For the top 2–3 highest-impact journeys, generate Playwright tests.

See `references/vitest-playwright-patterns.md` for full test patterns.

### Auth Flow Test Pattern

```typescript
// tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('user can sign in and access protected page', async ({ page }) => {
    await page.goto('/login')
    await expect(page).toHaveTitle(/login/i)

    // Use env vars for test credentials — never hardcode
    await page.fill('[name="email"]', process.env.TEST_USER_EMAIL!)
    await page.fill('[name="password"]', process.env.TEST_USER_PASSWORD!)
    await page.click('[type="submit"]')

    await expect(page).toHaveURL(/dashboard/)
    await expect(page.locator('h1')).toBeVisible()
  })

  test('unauthenticated user is redirected to login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/login/)
  })
})
```

### Core Data Creation Test Pattern

```typescript
// tests/e2e/{entity}-creation.spec.ts
import { test, expect } from '@playwright/test'

test.describe('{Entity} Creation', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in before each test
    await page.goto('/login')
    await page.fill('[name="email"]', process.env.TEST_USER_EMAIL!)
    await page.fill('[name="password"]', process.env.TEST_USER_PASSWORD!)
    await page.click('[type="submit"]')
    await page.waitForURL(/dashboard/)
  })

  test('user can create a new {entity}', async ({ page }) => {
    await page.goto('/{entity}/new')

    // Fill form fields (inferred from app code)
    // ...

    await page.click('[type="submit"]')
    await expect(page.locator('[data-testid="success-message"]')).toBeVisible()
  })
})
```

---

## Step 6 — Generate GitHub Actions CI Workflow

Generate `.github/workflows/ci.yml`. This workflow runs on every push and pull request, and **blocks merges to main if any test fails**.

See `references/github-actions-workflow.md` for the full annotated workflow template.

Key properties:
- Runs Vitest tests (unit + integration)
- Runs Playwright e2e tests
- Blocks merge to main via required status checks
- Uses `--bail` on CI to fail fast
- Caches `node_modules` and Playwright browsers for speed
- Never exposes real credentials — uses GitHub Secrets for env vars

---

## Step 7 — Output Checklist

After generating all files, verify:

- [ ] `vitest.config.ts` exists and references the setup file
- [ ] `playwright.config.ts` exists with `forbidOnly: !!process.env.CI`
- [ ] `tests/setup.ts` starts/resets/stops the MSW server
- [ ] `tests/mocks/server.ts` imports handlers for every paid service found
- [ ] One mock handler file per external paid service
- [ ] One Vitest test file per API route (at minimum: 200, 401, 500 cases)
- [ ] One Playwright test per high-impact journey
- [ ] `.github/workflows/ci.yml` runs both test suites
- [ ] No real credentials or personal values in any test file
- [ ] Test env vars documented in `.env.local.template` with `TEST_` prefix
- [ ] `package.json` scripts updated: `"test": "vitest"`, `"test:e2e": "playwright test"`

---

## References

- `references/journey-inference.md` — How to infer critical user journeys from app code
- `references/api-mock-patterns.md` — MSW mock templates for Anthropic, Resend, Supabase, Stripe
- `references/vitest-playwright-patterns.md` — Test patterns and best practices
- `references/github-actions-workflow.md` — Full CI workflow template with annotations
