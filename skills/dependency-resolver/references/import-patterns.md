# Import Patterns Reference

Complete reference for classifying imports during dependency resolution.

---

## Node.js Built-in Modules

These are part of Node.js itself — they must never appear in `package.json` and should be skipped during the missing-package scan.

### Node.js Core Modules (skip these)

```
assert, async_hooks, buffer, child_process, cluster, console, constants,
crypto, dgram, diagnostics_channel, dns, domain, events, fs, fs/promises,
http, http2, https, inspector, module, net, os, path, path/posix, path/win32,
perf_hooks, process, punycode, querystring, readline, repl, stream,
stream/consumers, stream/promises, stream/web, string_decoder, sys,
timers, timers/promises, tls, trace_events, tty, url, util, util/types,
v8, vm, wasi, worker_threads, zlib
```

Also skip `node:*` prefixed imports (Node.js 14.18+ style):
```
node:fs, node:path, node:crypto, etc.
```

---

## Virtual Modules and Framework Internals

These appear as imports but are resolved by the framework, not npm. Skip them.

### Next.js Virtual / Internal Modules

```
next
next/app
next/cache
next/config
next/dist/*
next/dynamic
next/font/*
next/headers
next/image
next/link
next/navigation
next/router
next/script
next/server
```

### React Virtual Modules

```
react
react-dom
react/jsx-runtime
react/jsx-dev-runtime
react-dom/client
react-dom/server
```

Note: `react` and `react-dom` themselves should still be in `package.json` — they're just exempt from the "must be imported to be declared" check because they're sometimes used implicitly.

### Vite / Build Tool Virtual Modules

```
vite
vite/client
vitest
vitest/config
@vitejs/*
```

### Other Framework Internals

```
astro:*           (Astro framework)
$app/*            (SvelteKit)
$lib/*            (SvelteKit)
```

---

## Packages That Are Always devDependencies

These packages are only used during development, testing, or building. If they're missing from `devDependencies` (or `dependencies`), flag them as missing dev deps, not runtime deps.

### Testing

```
vitest
@vitest/coverage-v8
@vitest/ui
jest
@jest/globals
@types/jest
msw
@testing-library/react
@testing-library/user-event
@testing-library/jest-dom
@playwright/test
playwright
supertest
@types/supertest
nock
```

### TypeScript / Type Definitions

```
typescript
@types/*           (any @types/ scoped package)
ts-node
tsx
```

### Linting / Formatting

```
eslint
@eslint/*
eslint-config-*
eslint-plugin-*
prettier
@prettier/*
```

### Build Tools

```
@vitejs/plugin-react
@vitejs/plugin-react-swc
vite
rollup
webpack
esbuild
swc
turbo
```

### Tailwind / CSS Build

```
tailwindcss
@tailwindcss/*
postcss
autoprefixer
cssnano
```

---

## Packages with Implicit Use (No Import Required)

These are declared in `package.json` but not necessarily imported anywhere in source code. **Do not flag as unused.**

```
typescript            # Invoked via tsc, not imported
eslint                # Invoked via CLI, not imported
prettier              # Invoked via CLI, not imported
@types/*              # Ambient type declarations
postcss               # Used via postcss.config.js
tailwindcss           # Used via tailwind.config.ts
autoprefixer          # Used via postcss.config.js
next                  # Framework — entry is handled by Next.js, not explicit imports
react                 # JSX transform in React 17+ doesn't require explicit import
react-dom             # Paired with react
tsx                   # TypeScript runner for scripts
ts-node               # TypeScript runner for scripts
husky                 # Git hooks manager — no imports
lint-staged           # Pre-commit tool — no imports
@playwright/test      # May only appear in playwright.config.ts
cross-env             # CLI tool for env vars
dotenv-cli            # CLI tool for env vars
```

---

## Dev vs Runtime Classification Logic

```bash
is_dev_package() {
  local pkg="$1"
  local DEV_PATTERNS=(
    "^@types/"
    "^typescript$"
    "^eslint"
    "^prettier"
    "^vitest"
    "^@vitest/"
    "^jest"
    "^@jest/"
    "^msw$"
    "^@testing-library/"
    "^@playwright/"
    "^playwright$"
    "^supertest"
    "^nock$"
    "^@vitejs/"
    "^tailwindcss$"
    "^postcss$"
    "^autoprefixer$"
    "^husky$"
    "^lint-staged$"
    "^tsx$"
    "^ts-node$"
    "^turbo$"
    "^rollup$"
    "^esbuild$"
  )

  for pattern in "${DEV_PATTERNS[@]}"; do
    echo "$pkg" | grep -qE "$pattern" && return 0
  done
  return 1
}
```

---

## Scoped Package Name Normalisation

```
Import string                    → Normalised package name
─────────────────────────────────────────────────────────
@supabase/supabase-js            → @supabase/supabase-js
@supabase/ssr                    → @supabase/ssr
@anthropic-ai/sdk                → @anthropic-ai/sdk
@playwright/test                 → @playwright/test
@testing-library/react           → @testing-library/react
@vitejs/plugin-react             → @vitejs/plugin-react
@types/node                      → @types/node
msw/node                         → msw
msw/browser                      → msw
vitest/config                    → vitest
next/navigation                  → next
next/headers                     → next
react/jsx-runtime                → react
lodash/merge                     → lodash
date-fns/format                  → date-fns
zod/v4                           → zod
```

---

## Monorepo / Workspace Packages

If the project uses npm/pnpm/yarn workspaces, some imports may be workspace-local packages (e.g., `@household-app-infrastructure/shared`). Skip these during the missing-package scan:

```bash
# Read workspace package names from package.json
WORKSPACE_PKGS=$(jq -r '.workspaces[]? // empty' package.json 2>/dev/null | \
  xargs -I{} sh -c 'jq -r ".name" {}/package.json 2>/dev/null' | sort -u)

# Also check pnpm-workspace.yaml and lerna.json
```

If a workspace package is declared but doesn't exist on disk, flag it separately as a workspace misconfiguration, not a missing npm package.
