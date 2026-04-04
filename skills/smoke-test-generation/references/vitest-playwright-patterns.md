# Vitest and Playwright Test Patterns

Best practices and patterns for writing smoke tests in Household App Infrastructure apps.

---

## Vitest Patterns

### Test File Structure

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('{Feature or Route Name}', () => {
  // Setup shared across all tests in this block
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('happy path', () => {
    it('{does the expected thing}', async () => {
      // Arrange
      // Act
      // Assert
    })
  })

  describe('error cases', () => {
    it('returns 401 when unauthenticated', async () => { })
    it('returns 400 on invalid input', async () => { })
    it('returns 500 on database error', async () => { })
  })
})
```

### Testing Next.js Route Handlers Directly

Next.js App Router route handlers (`app/api/*/route.ts`) export async functions. Test them directly without spinning up the server:

```typescript
// Import the handler under test
import { GET, POST } from '@/app/api/sessions/route'

it('GET /api/sessions returns sessions array', async () => {
  // Mock the DB response
  vi.mocked(supabase.select).mockResolvedValueOnce({
    data: [{ id: 'uuid-1', discipline: 'run' }],
    error: null,
  })

  const req = new Request('http://localhost/api/sessions')
  const res = await GET(req)

  expect(res.status).toBe(200)
  const data = await res.json()
  expect(Array.isArray(data)).toBe(true)
})
```

### Testing React Components

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionForm } from '@/components/SessionForm'

describe('SessionForm', () => {
  it('submits form data correctly', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(<SessionForm onSubmit={onSubmit} />)

    await user.selectOptions(screen.getByLabelText(/discipline/i), 'run')
    await user.type(screen.getByLabelText(/distance/i), '10')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ discipline: 'run', distanceKm: 10 })
      )
    })
  })
})
```

### Testing LLM-Powered Functions

Since MSW mocks the Anthropic API at the network layer, test LLM functions just like any async function:

```typescript
import { generateCoachingFeedback } from '@/lib/coaching'

describe('generateCoachingFeedback', () => {
  it('returns feedback text from Anthropic', async () => {
    const result = await generateCoachingFeedback({
      sessions: [{ discipline: 'run', distanceKm: 10, durationSeconds: 3600 }],
    })

    // MSW returns "Mock response from Anthropic. This is a test."
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('throws on Anthropic error', async () => {
    server.use(anthropicErrorHandler)

    await expect(
      generateCoachingFeedback({ sessions: [] })
    ).rejects.toThrow()
  })
})
```

### Snapshot Testing for Stable UI

Use sparingly — only for components that should not change unexpectedly:

```typescript
it('renders session card correctly', () => {
  const { container } = render(
    <SessionCard session={{ id: 'test', discipline: 'swim', distanceKm: 2 }} />
  )
  expect(container.firstChild).toMatchSnapshot()
})
```

---

## Playwright Patterns

### Page Object Model

For reusable interactions, create page objects:

```typescript
// tests/e2e/pages/LoginPage.ts
import { Page, Locator } from '@playwright/test'

export class LoginPage {
  readonly page: Page
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly submitButton: Locator

  constructor(page: Page) {
    this.page = page
    this.emailInput = page.locator('[name="email"]')
    this.passwordInput = page.locator('[name="password"]')
    this.submitButton = page.locator('[type="submit"]')
  }

  async goto() {
    await this.page.goto('/login')
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }
}
```

```typescript
// tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/LoginPage'

test('user can log in', async ({ page }) => {
  const loginPage = new LoginPage(page)
  await loginPage.goto()
  await loginPage.login(
    process.env.TEST_USER_EMAIL!,
    process.env.TEST_USER_PASSWORD!
  )
  await expect(page).toHaveURL(/dashboard/)
})
```

### Authentication State Reuse

Avoid logging in before every test — save auth state:

```typescript
// tests/e2e/auth.setup.ts
import { test as setup } from '@playwright/test'

const authFile = 'tests/e2e/.auth/user.json'

setup('authenticate', async ({ page }) => {
  await page.goto('/login')
  await page.fill('[name="email"]', process.env.TEST_USER_EMAIL!)
  await page.fill('[name="password"]', process.env.TEST_USER_PASSWORD!)
  await page.click('[type="submit"]')
  await page.waitForURL(/dashboard/)

  // Save auth state — reuse in other tests
  await page.context().storageState({ path: authFile })
})
```

```typescript
// playwright.config.ts (addition)
projects: [
  {
    name: 'setup',
    testMatch: /auth\.setup/,
  },
  {
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'tests/e2e/.auth/user.json',
    },
    dependencies: ['setup'],
  },
]
```

### Waiting for Network Requests

```typescript
test('loads sessions from API', async ({ page }) => {
  // Wait for the specific API call to complete
  const responsePromise = page.waitForResponse(
    resp => resp.url().includes('/api/sessions') && resp.status() === 200
  )

  await page.goto('/sessions')
  const response = await responsePromise

  expect(response.status()).toBe(200)
  await expect(page.locator('[data-testid="session-list"]')).toBeVisible()
})
```

### Intercepting and Mocking in Playwright

For Playwright e2e tests against a real dev server, mock API routes to avoid hitting real databases:

```typescript
test('shows sessions from API', async ({ page }) => {
  await page.route('**/api/sessions', route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'uuid-1', discipline: 'run', distanceKm: 10 },
      ]),
    })
  })

  await page.goto('/sessions')
  await expect(page.locator('text=run')).toBeVisible()
})
```

### Assertions Best Practices

```typescript
// Prefer role-based selectors (accessible, resilient)
await expect(page.getByRole('button', { name: /save/i })).toBeVisible()
await expect(page.getByRole('heading', { name: /sessions/i })).toBeVisible()

// Use data-testid for elements without semantic roles
await expect(page.locator('[data-testid="session-count"]')).toHaveText('3 sessions')

// Avoid: CSS classes (brittle), XPath (verbose), text content for interactive elements
// Avoid: page.waitForTimeout() — use waitForURL, waitForResponse, or locator assertions
```

---

## Test Data Conventions

- **Test credentials:** Always from `process.env.TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — never hardcoded
- **Test IDs:** Use `test-uuid-` prefix: `'test-uuid-session-001'`
- **Test emails:** Always `@example.com` domain — distinguishes synthetic from real
- **Test names:** `'Test User'`, `'Mock Partner'` — obviously synthetic
- **Test amounts:** Round numbers — `10.0`, `100`, `3600` — not realistic-looking values

---

## Coverage Thresholds

For smoke tests, enforce minimum coverage only on critical paths:

```typescript
// vitest.config.ts
coverage: {
  thresholds: {
    // Minimum branch coverage for API routes
    'app/api/**': {
      branches: 70,
      functions: 80,
    },
  },
}
```

Do not enforce 100% coverage for smoke tests — that's a full test suite goal.
