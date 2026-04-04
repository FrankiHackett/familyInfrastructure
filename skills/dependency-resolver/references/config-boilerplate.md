# Required Config Boilerplate

For each package that requires additional configuration files beyond the npm install, this reference provides the minimal working template. Check for each file's existence before generating — never overwrite existing config.

---

## Vitest

**Check:** Does `vitest.config.ts` exist?

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules', '.next'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        'tests/',
        '*.config.*',
        'lib/config/validate-env.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
})
```

**Check:** Does `tests/setup.ts` exist?

```typescript
// tests/setup.ts
import { afterEach, beforeAll, afterAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './mocks/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())
```

**package.json scripts to add:**

```json
{
  "test": "vitest",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage",
  "test:watch": "vitest watch"
}
```

---

## Playwright

**Check:** Does `playwright.config.ts` exist?

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
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stderr: 'pipe',
  },
})
```

**Post-install step** (must be run manually or in CI setup):

```bash
npx playwright install --with-deps chromium
```

**package.json scripts to add:**

```json
{
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:debug": "playwright test --debug"
}
```

---

## MSW (Mock Service Worker)

**Check:** Does `tests/mocks/server.ts` exist?

```typescript
// tests/mocks/server.ts
import { setupServer } from 'msw/node'
// Import handlers as you add them
// import { anthropicHandlers } from './handlers/anthropic'

export const server = setupServer(
  // ...anthropicHandlers,
)
```

**Check:** Does `tests/mocks/handlers/` directory exist?
Create it empty if not — handlers are added per-service by the smoke-test-generation skill.

**For browser-based testing (Playwright):**

```bash
# Initialise the MSW service worker in the public directory
npx msw init public/ --save
```

This generates `public/mockServiceWorker.js`. Add to `.gitignore` if preferred, or commit it.

---

## Tailwind CSS

**Check:** Does `tailwind.config.ts` exist?

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

export default config
```

**Check:** Does `postcss.config.js` exist?

```javascript
// postcss.config.js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

**CSS entry** — add to `app/globals.css` or `styles/globals.css` if missing:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

---

## ESLint (Next.js)

**Check:** Does `.eslintrc.json` or `eslint.config.js` exist?

```json
// .eslintrc.json (legacy format)
{
  "extends": ["next/core-web-vitals", "next/typescript"]
}
```

```javascript
// eslint.config.js (flat config format — ESLint 9+)
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
]
```

**package.json scripts to add:**

```json
{
  "lint": "next lint",
  "lint:fix": "next lint --fix"
}
```

---

## Prettier

**Check:** Does `.prettierrc` exist?

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

**Check:** Does `.prettierignore` exist?

```
node_modules/
.next/
dist/
build/
coverage/
*.lock
public/mockServiceWorker.js
```

---

## TypeScript

**Check:** Does `tsconfig.json` exist?

For Next.js, `tsconfig.json` is auto-generated. If missing, run:
```bash
npx tsc --init
```

Or generate with Next.js defaults:
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

---

## Supabase Client

If `@supabase/supabase-js` is missing and no client file exists, defer to the schema-generation skill. If the package is present but no client helper exists, generate a minimal one:

**Check:** Does `lib/supabase/client.ts` exist?

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

**Check:** Does `lib/supabase/server.ts` exist?

```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookie setting is a no-op
          }
        },
      },
    }
  )
}
```

Note: `@supabase/ssr` is a separate package from `@supabase/supabase-js` and must be installed separately.
