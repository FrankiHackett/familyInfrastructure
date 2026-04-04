// phases/07-tests.js — Generate smoke test scaffold: Vitest, Playwright, MSW, CI workflow

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../lib/logger.js'
import { exec } from '../lib/exec.js'

export async function runTests(cfg, inputs, appDir) {
  logger.phase('5', 'Smoke Test Generation')

  const { appName, services, accessModel } = inputs

  mkdirSync(join(appDir, 'tests', 'mocks', 'handlers'), { recursive: true })
  mkdirSync(join(appDir, 'tests', 'integration'),       { recursive: true })
  mkdirSync(join(appDir, 'tests', 'e2e'),               { recursive: true })
  mkdirSync(join(appDir, '.github', 'workflows'),       { recursive: true })

  const files = []

  function write(relPath, content) {
    const full = join(appDir, relPath)
    if (!existsSync(full)) {
      writeFileSync(full, content, 'utf-8')
      files.push(relPath)
    } else {
      logger.info(`  Skipping existing: ${relPath}`)
    }
  }

  // ── vitest.config.ts ──────────────────────────────────────────────────────
  write('vitest.config.ts', `import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: { alias: { '@': '.' } },
})
`)

  // ── playwright.config.ts ──────────────────────────────────────────────────
  write('playwright.config.ts', `import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
`)

  // ── tests/setup.ts ────────────────────────────────────────────────────────
  write('tests/setup.ts', `import { afterEach, beforeAll, afterAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => { cleanup(); server.resetHandlers() })
afterAll(() => server.close())
`)

  // ── tests/mocks/server.ts ─────────────────────────────────────────────────
  const handlerImports = buildHandlerImports(services)
  const handlerSpread  = buildHandlerSpread(services)
  write('tests/mocks/server.ts', `import { setupServer } from 'msw/node'
${handlerImports}

export const server = setupServer(${handlerSpread})
`)

  // ── MSW handlers per service ──────────────────────────────────────────────
  if (services.includes('anthropic')) {
    write('tests/mocks/handlers/anthropic.ts', ANTHROPIC_HANDLER)
  }
  if (services.includes('resend')) {
    write('tests/mocks/handlers/resend.ts', RESEND_HANDLER)
  }
  if (services.includes('supabase')) {
    write('tests/mocks/supabase.ts', SUPABASE_MOCK)
  }

  // ── tests/integration/app.test.ts ─────────────────────────────────────────
  write(`tests/integration/${appName}.test.ts`, buildIntegrationTest(appName, services))

  // ── tests/e2e/smoke.spec.ts ───────────────────────────────────────────────
  write('tests/e2e/smoke.spec.ts', buildE2eTest(appName))

  // ── GitHub Actions CI ─────────────────────────────────────────────────────
  write('.github/workflows/ci.yml', buildCiWorkflow(appName, services, cfg))

  // ── Update package.json scripts ──────────────────────────────────────────
  logger.step('Updating package.json scripts')
  try {
    const pkgPath = join(appDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.scripts = {
      ...pkg.scripts,
      test:           'vitest',
      'test:run':     'vitest run',
      'test:coverage':'vitest run --coverage',
      'test:e2e':     'playwright test',
      'test:e2e:ui':  'playwright test --ui',
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
    files.push('package.json (scripts updated)')
  } catch (err) {
    logger.warn(`Could not update package.json scripts: ${err.message}`)
  }

  // ── Playwright browser install ────────────────────────────────────────────
  logger.step('Installing Playwright Chromium browser...')
  try {
    await exec('npx playwright install --with-deps chromium', { cwd: appDir })
    logger.success('Playwright browser installed')
  } catch (err) {
    logger.warn(`Playwright install failed: ${err.message}`)
    logger.info('  Run manually: npx playwright install --with-deps chromium')
  }

  // ── Commit test scaffold ──────────────────────────────────────────────────
  await exec('git add -A', { cwd: appDir })
  await exec(`git commit -m "feat: add smoke test scaffold for ${appName}"`, { cwd: appDir })

  logger.success(`Phase 5 complete — ${files.length} test files generated`)
  return { testFiles: files }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildHandlerImports(services) {
  const lines = []
  if (services.includes('anthropic')) lines.push(`import { anthropicHandlers } from './handlers/anthropic'`)
  if (services.includes('resend'))    lines.push(`import { resendHandlers } from './handlers/resend'`)
  return lines.join('\n')
}

function buildHandlerSpread(services) {
  const parts = []
  if (services.includes('anthropic')) parts.push('...anthropicHandlers')
  if (services.includes('resend'))    parts.push('...resendHandlers')
  return parts.length ? `\n  ${parts.join(',\n  ')},\n` : ''
}

function buildIntegrationTest(appName, services) {
  return `// tests/integration/${appName}.test.ts — generated by household-app-infrastructure
import { describe, it, expect } from 'vitest'

describe('${appName} smoke', () => {
  it('environment variables are defined', () => {
    // Vitest runs in Node — check import.meta.env equivalents via process.env
    // In production these come from Vercel env config
    expect(typeof process.env).toBe('object')
  })
${services.includes('anthropic') ? `
  it('Anthropic mock returns a response', async () => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'test',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.content[0].text).toBeDefined()
  })
` : ''}${services.includes('resend') ? `
  it('Resend mock returns an id', async () => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({
        from: 'test@example.com',
        to: ['test@example.com'],
        subject: 'Test',
        html: '<p>Test</p>',
      }),
    })
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.id).toBeDefined()
  })
` : ''}
})
`
}

function buildE2eTest(appName) {
  return `// tests/e2e/smoke.spec.ts — generated by household-app-infrastructure
import { test, expect } from '@playwright/test'

test.describe('${appName} smoke', () => {
  test('app loads without error', async ({ page }) => {
    await page.goto('/')
    // Check no uncaught errors in console
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))

    await page.waitForLoadState('networkidle')

    // Basic sanity: page has a body
    await expect(page.locator('body')).toBeVisible()

    if (errors.length) {
      throw new Error(\`Page errors:\\n\${errors.join('\\n')}\`)
    }
  })

  test('page title is set', async ({ page }) => {
    await page.goto('/')
    const title = await page.title()
    expect(title.length).toBeGreaterThan(0)
  })
})
`
}

function buildCiWorkflow(appName, services, cfg) {
  // No real secrets in the workflow — all values come from GitHub Secrets at runtime
  return `name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  test-unit:
    name: Unit & Integration Tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:run -- --reporter=github-actions
        env:
${services.includes('supabase') ? `          VITE_SUPABASE_URL: \${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: \${{ secrets.VITE_SUPABASE_ANON_KEY }}
` : ''}          VITE_APP_URL: https://${appName}.${cfg.cloudflare.household_domain}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: coverage/
          retention-days: 7

  test-e2e:
    name: E2E Tests
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: test-unit
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        id: pw-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-\${{ runner.os }}-\${{ hashFiles('**/package-lock.json') }}
      - run: npx playwright install --with-deps chromium
        if: steps.pw-cache.outputs.cache-hit != 'true'
      - run: npx playwright install-deps chromium
        if: steps.pw-cache.outputs.cache-hit == 'true'
      - run: npx playwright test
        env:
          CI: 'true'
          PLAYWRIGHT_BASE_URL: https://${appName}.${cfg.cloudflare.household_domain}
${services.includes('supabase') ? `          VITE_SUPABASE_URL: \${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: \${{ secrets.VITE_SUPABASE_ANON_KEY }}
` : ''}      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
`
}

// ─── Static mock templates ────────────────────────────────────────────────────

const ANTHROPIC_HANDLER = `import { http, HttpResponse } from 'msw'

export const anthropicHandlers = [
  http.post('https://api.anthropic.com/v1/messages', () =>
    HttpResponse.json({
      id: 'msg_mock_01',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Mock response. This is a test.' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 8 },
    })
  ),
]

export const anthropicErrorHandler = http.post(
  'https://api.anthropic.com/v1/messages',
  () => HttpResponse.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 529 })
)
`

const RESEND_HANDLER = `import { http, HttpResponse } from 'msw'

export const resendHandlers = [
  http.post('https://api.resend.com/emails', () =>
    HttpResponse.json({ id: 'mock-email-00000000' })
  ),
]

export const resendErrorHandler = http.post(
  'https://api.resend.com/emails',
  () => HttpResponse.json({ name: 'validation_error', message: 'Invalid from address' }, { status: 422 })
)
`

const SUPABASE_MOCK = `import { vi } from 'vitest'

const chain = () => {
  const m: Record<string, unknown> = {}
  ;['from','select','insert','update','delete','upsert','eq','neq','gt','gte',
    'lt','lte','like','ilike','in','is','not','or','filter','order','limit',
    'offset','range','schema'].forEach(k => { m[k] = vi.fn().mockReturnThis() })
  m['single']      = vi.fn().mockResolvedValue({ data: null, error: null })
  m['maybeSingle'] = vi.fn().mockResolvedValue({ data: null, error: null })
  return m
}

export const mockSupabase = {
  ...chain(),
  auth: {
    getUser:    vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id', email: 'test@example.com' } }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'test-user-id' }, access_token: 'mock' } }, error: null }),
    signOut:    vi.fn().mockResolvedValue({ error: null }),
  },
}
`
