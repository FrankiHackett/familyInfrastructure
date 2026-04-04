---
name: dependency-resolver
description: This skill should be used when the user asks to "check dependencies", "find missing packages", "audit imports", "generate npm install command", "fix missing modules", "check for unused packages", or when setting up a new Household App Infrastructure app for the first time. Scans all import statements, compares against package.json, identifies missing and unused packages, flags client-side exposure risks, and generates required config boilerplate for each dependency.
version: 1.0.0
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# Dependency Resolver

Scans all import statements across the codebase, compares against `package.json`, produces a definitive gap and redundancy report, generates the exact `npm install` command needed, and flags any packages that carry client-side exposure risks. Also generates required config boilerplate for packages that need it (e.g., MSW, Playwright, Vitest).

## When This Skill Applies

Activate when the user:
- Gets "Cannot find module" or "Module not found" errors
- Is scaffolding a new Household App Infrastructure app from a code template
- Wants to clean up unused dependencies
- Wants to verify no packages are accidentally bundled client-side
- Asks what `npm install` command to run

---

## Step 1 — Collect All Import Statements

Scan every source file for import statements. Cast a wide net — collect all, then filter.

### Scan Targets

```
Glob: **/*.ts    (excluding node_modules, .next, dist, build)
Glob: **/*.tsx
Glob: **/*.js
Glob: **/*.jsx
Glob: **/*.mjs
```

### Import Patterns to Match

```bash
# ES module static imports
Grep: ^import\s+.*\s+from\s+['"]([^'"./][^'"]*)['"]
#         ^^ captures: import ... from 'package-name'

# ES module dynamic imports
Grep: import\(['"]([^'"./][^'"]*)['"]\)
#         ^^ captures: import('package-name')

# CommonJS require
Grep: require\(['"]([^'"./][^'"]*)['"]\)
#         ^^ captures: require('package-name')

# Side-effect imports
Grep: ^import\s+['"]([^'"./][^'"]*)['"]
#         ^^ captures: import 'package-name'
```

### Normalise Package Names

From each matched import string, extract the npm package name:

```
'@supabase/supabase-js'     → @supabase/supabase-js   (scoped package)
'@anthropic-ai/sdk'         → @anthropic-ai/sdk
'react'                     → react
'vitest/config'             → vitest                   (strip sub-path)
'msw/node'                  → msw
'@playwright/test'          → @playwright/test
'next/navigation'           → next                     (strip sub-path)
'lodash/merge'              → lodash
```

Rule: take everything up to but not including a second `/` for scoped packages (`@scope/pkg`), or up to the first `/` for unscoped packages.

```bash
normalise_pkg() {
  local raw="$1"
  if [[ "$raw" == @* ]]; then
    # Scoped: @scope/pkg[/subpath] → @scope/pkg
    echo "$raw" | cut -d'/' -f1,2
  else
    # Unscoped: pkg[/subpath] → pkg
    echo "$raw" | cut -d'/' -f1
  fi
}
```

Collect, deduplicate, sort. This is `IMPORTED_PKGS`.

---

## Step 2 — Read package.json

Read `package.json` and extract all declared dependencies.

```bash
if [ ! -f package.json ]; then
  echo "ERROR: No package.json found in current directory."
  exit 1
fi

# All runtime dependencies
DEPS=$(jq -r '.dependencies // {} | keys[]' package.json 2>/dev/null)

# All dev dependencies
DEV_DEPS=$(jq -r '.devDependencies // {} | keys[]' package.json 2>/dev/null)

# Combined — all declared packages
ALL_DECLARED=$(echo -e "$DEPS\n$DEV_DEPS" | sort -u)
```

Also read the `peerDependencies` and `optionalDependencies` fields — packages listed there don't need to be in `dependencies` but should be present in `node_modules`.

```bash
PEER_DEPS=$(jq -r '.peerDependencies // {} | keys[]' package.json 2>/dev/null)
```

---

## Step 3 — Identify Missing Packages

```bash
MISSING_PKGS=()
MISSING_DEV_PKGS=()

for PKG in "${IMPORTED_PKGS[@]}"; do
  # Skip built-in Node modules
  is_node_builtin "$PKG" && continue

  # Skip Next.js / React virtual modules
  is_virtual_module "$PKG" && continue

  if ! echo "$ALL_DECLARED" | grep -qx "$PKG"; then
    # Classify: should this be a dep or devDep?
    if is_dev_package "$PKG"; then
      MISSING_DEV_PKGS+=("$PKG")
    else
      MISSING_PKGS+=("$PKG")
    fi
  fi
done
```

See `references/import-patterns.md` for the full lists of:
- Node built-ins to skip
- Virtual modules to skip
- Packages that are always devDependencies

### Report Missing Packages

```
MISSING DEPENDENCIES (npm install --save):
  @supabase/supabase-js    imported in: lib/supabase/client.ts, app/api/sessions/route.ts
  anthropic                imported in: lib/ai/client.ts
  resend                   imported in: lib/email/send.ts

MISSING DEV DEPENDENCIES (npm install --save-dev):
  vitest                   imported in: vitest.config.ts, tests/setup.ts
  @playwright/test         imported in: playwright.config.ts, tests/e2e/*.spec.ts
  msw                      imported in: tests/mocks/server.ts

Total missing: 3 runtime, 3 dev
```

---

## Step 4 — Identify Unused Packages

```bash
UNUSED_PKGS=()

for PKG in $ALL_DECLARED; do
  # Check if this package is imported anywhere in the codebase
  # Use the package name as the import string to match
  if ! grep -rqE "from ['\"]${PKG}['\"/]|require\(['\"]${PKG}['\"/]" \
       --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
       --exclude-dir=node_modules --exclude-dir=.next \
       . 2>/dev/null; then
    UNUSED_PKGS+=("$PKG")
  fi
done
```

### False Positive Filter

Some packages are used without an explicit import — filter these before reporting:

```bash
IMPLICIT_USE_PKGS=(
  "typescript"          # Compiler — not imported
  "eslint"              # Linter — not imported
  "prettier"            # Formatter — not imported
  "@types/*"            # Type definitions — not imported directly
  "postcss"             # CSS processor — used via config
  "tailwindcss"         # CSS framework — used via config
  "autoprefixer"        # PostCSS plugin — used via config
  "next"                # Framework — may not appear as import everywhere
  "react"               # Often not explicitly imported in React 17+
  "react-dom"           # Paired with react
  "tsx"                 # TypeScript runner — not imported
  "ts-node"             # TypeScript runner — not imported
)
```

Flag remaining unused packages but do not auto-remove them. See `references/import-patterns.md` for the full implicit-use list.

### Report Unused Packages

```
UNUSED PACKAGES (declared but not imported in any source file):
  old-analytics-sdk    in: dependencies (consider removing with: npm uninstall old-analytics-sdk)
  lodash               in: dependencies (may be implicit — verify before removing)

Note: Unused devDependencies are lower risk. Review before removing.
```

---

## Step 5 — Generate npm Install Command

Build the exact command(s) needed.

```bash
# Runtime deps
if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
  RUNTIME_CMD="npm install ${MISSING_PKGS[*]}"
fi

# Dev deps
if [ ${#MISSING_DEV_PKGS[@]} -gt 0 ]; then
  DEV_CMD="npm install -D ${MISSING_DEV_PKGS[*]}"
fi
```

Output format:

```
INSTALL COMMANDS:
─────────────────────────────────────────────────────────────
# Runtime dependencies
npm install @supabase/supabase-js anthropic resend

# Dev dependencies
npm install -D vitest @vitest/coverage-v8 @vitejs/plugin-react @playwright/test msw @testing-library/react @testing-library/user-event

# After installing Playwright browsers:
npx playwright install --with-deps chromium
─────────────────────────────────────────────────────────────
```

If nothing is missing:
```
All imported packages are declared in package.json. No install needed.
```

---

## Step 6 — Required Config Boilerplate

For packages that require additional setup files, generate them if absent. Check each missing or newly-installed package against the config requirements table.

See `references/config-boilerplate.md` for full templates.

| Package | Required Config File(s) |
|---|---|
| `vitest` | `vitest.config.ts`, `tests/setup.ts` |
| `@playwright/test` | `playwright.config.ts` |
| `msw` | `tests/mocks/server.ts`, `public/mockServiceWorker.js` |
| `tailwindcss` | `tailwind.config.ts`, `postcss.config.js` |
| `eslint` | `.eslintrc.json` or `eslint.config.js` |
| `prettier` | `.prettierrc` |
| `@supabase/supabase-js` | Supabase client helper (see schema-generation skill) |

For each config that is missing, either generate it or note it as a required manual step.

---

## Step 7 — Client-Side Bundle Risk Audit

Some packages should never appear in client-side code. Check whether any imports of server-only packages occur in files that are part of the client bundle.

### What Counts as Client-Side

In Next.js App Router:
- Files in `app/` that are **not** `route.ts` / `route.js` and do not have `'use server'` at the top
- Any file imported from a Client Component (files with `'use client'` directive)
- Files in `components/` unless explicitly server-only

In Next.js Pages Router:
- Files in `pages/` (except `pages/api/`)
- Files imported from page components

### Server-Only Packages That Must Not Be in Client Bundle

```bash
SERVER_ONLY_PKGS=(
  "anthropic"
  "@anthropic-ai/sdk"
  "openai"
  "resend"
  "stripe"
  "pg"
  "postgres"
  "drizzle-orm"
  "@supabase/supabase-js/src/SupabaseClient"  # service-role usage
  "nodemailer"
  "sharp"
  "fs"
  "path"
  "crypto"
  "child_process"
)
```

For each server-only package, check whether it's imported from a client-side file:

```bash
for PKG in "${SERVER_ONLY_PKGS[@]}"; do
  # Find files that import this package
  IMPORT_FILES=$(grep -rl --include="*.ts" --include="*.tsx" \
    "from ['\"]${PKG}" . \
    --exclude-dir=node_modules --exclude-dir=.next 2>/dev/null)

  for FILE in $IMPORT_FILES; do
    # Check if file is client-side
    if is_client_file "$FILE"; then
      echo "CLIENT BUNDLE RISK: $PKG imported in client file: $FILE"
      echo "  Move usage to a server-side API route."
    fi
  done
done
```

See `references/client-bundle-risks.md` for the full risk table and detection patterns.

---

## Step 8 — Full Summary

```
============================================================
Dependency Resolver — {app-name}
============================================================
Scanned:     {n} source files, {m} unique package imports

MISSING RUNTIME:    {n} packages
MISSING DEV:        {n} packages
UNUSED:             {n} packages (review before removing)
BUNDLE RISKS:       {n} server-only packages in client files

INSTALL COMMANDS:
  npm install {runtime packages}
  npm install -D {dev packages}
  npx playwright install --with-deps chromium  [if Playwright added]

CONFIG BOILERPLATE NEEDED:
  {list of files to generate}

Next steps:
  1. Run the install commands above
  2. Review and remove unused packages if confirmed unnecessary
  3. Fix any client bundle risks before deploying
============================================================
```

---

## References

- `references/import-patterns.md` — Node built-ins, virtual modules, implicit-use packages, dev-only classifiers
- `references/config-boilerplate.md` — Required config file templates for common packages
- `references/client-bundle-risks.md` — Server-only packages, client file detection, remediation patterns
