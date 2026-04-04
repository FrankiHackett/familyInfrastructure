---
name: env-var-audit
description: This skill should be used when the user asks to "audit environment variables", "check env vars", "find missing env vars", "generate .env template", "add startup validation", "check for exposed API keys", or when setting up a new Household App Infrastructure app for the first time. Scans all app code for external service calls, compares against existing env config, reports gaps and redundancies, generates a .env.local.template, and writes a startup validation function.
version: 1.0.0
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# Environment Variable Audit

Scans all app code to discover every environment variable that is used or required, compares against what is currently configured, and produces a gap/redundancy report. Generates a `.env.local.template` and a startup validation function that fails loudly at boot if required variables are missing. Flags any keys that are exposed client-side but should be kept server-side only.

## When This Skill Applies

Activate when the user:
- Is setting up a new Household App Infrastructure app and wants to know what env vars are needed
- Suspects env vars are missing or misconfigured
- Wants a `.env.local.template` generated from the actual code
- Wants startup validation added to their app
- Wants to check for accidentally client-exposed secrets

---

## Step 1 — Discover All Environment Variable References

Scan the entire codebase for every `process.env.*` and `env.*` reference.

### Scan Patterns

```
Grep: process\.env\.[A-Z_]+
Grep: process\.env\['[A-Z_]+'\]
Grep: import\.meta\.env\.[A-Z_]+   (Vite apps)
Grep: env\.[A-Z_]+                 (destructured env object)
```

Exclude:
- `node_modules/`
- `.next/`
- `dist/`, `build/`
- `*.lock` files
- Test files (`*.test.ts`, `*.spec.ts`, `tests/`) — test vars audited separately

Extract the variable name from each match. Deduplicate. Collect with file paths for reporting.

### Categorise by Exposure

The prefix `NEXT_PUBLIC_` (Next.js) or `VITE_` (Vite) makes a variable available in client-side bundles. All other variables are server-side only.

```bash
CLIENT_VARS=()   # NEXT_PUBLIC_* or VITE_*
SERVER_VARS=()   # Everything else

for VAR in $ALL_VARS; do
  if echo "$VAR" | grep -qE '^(NEXT_PUBLIC_|VITE_)'; then
    CLIENT_VARS+=("$VAR")
  else
    SERVER_VARS+=("$VAR")
  fi
done
```

---

## Step 2 — Discover Current Env Configuration

Read what is actually configured in the project right now.

### Files to Check

In order of precedence (highest first for Next.js):
1. `.env.local` — local overrides, never committed
2. `.env.development.local` — dev overrides
3. `.env.production.local` — prod overrides
4. `.env.development` — dev defaults (may be committed)
5. `.env.production` — prod defaults (may be committed)
6. `.env` — shared defaults (may be committed)

```bash
CONFIGURED_VARS=()
ENV_FILES=(".env.local" ".env.development.local" ".env.production.local"
           ".env.development" ".env.production" ".env")

for FILE in "${ENV_FILES[@]}"; do
  if [ -f "$FILE" ]; then
    # Extract variable names only (not values — never log values)
    VARS_IN_FILE=$(grep -v '^#' "$FILE" | grep -v '^$' | cut -d'=' -f1 | grep -E '^[A-Z_]+')
    CONFIGURED_VARS+=($VARS_IN_FILE)
    echo "  Found $(echo "$VARS_IN_FILE" | wc -l | tr -d ' ') variables in $FILE"
  fi
done

# Deduplicate
CONFIGURED_VARS=($(echo "${CONFIGURED_VARS[@]}" | tr ' ' '\n' | sort -u))
echo "Total configured variables: ${#CONFIGURED_VARS[@]}"
```

**Never log variable values** — only names.

---

## Step 3 — Compare and Report

### Gap Report (Used but Not Configured)

```bash
MISSING_VARS=()
for VAR in "${ALL_VARS[@]}"; do
  if ! printf '%s\n' "${CONFIGURED_VARS[@]}" | grep -qx "$VAR"; then
    MISSING_VARS+=("$VAR")
  fi
done
```

Report format:

```
GAP REPORT — Variables used in code but NOT configured:
──────────────────────────────────────────────────────
MISSING (server-side):
  ANTHROPIC_API_KEY         used in: lib/ai/client.ts:3
  RESEND_API_KEY            used in: lib/email/send.ts:2
  SUPABASE_SERVICE_ROLE_KEY used in: app/api/admin/route.ts:7

MISSING (client-side — will be undefined in browser):
  NEXT_PUBLIC_SUPABASE_URL   used in: lib/supabase/client.ts:5
  NEXT_PUBLIC_SUPABASE_ANON_KEY used in: lib/supabase/client.ts:6

Total missing: 5
```

### Redundancy Report (Configured but Not Used)

```bash
UNUSED_VARS=()
for VAR in "${CONFIGURED_VARS[@]}"; do
  if ! printf '%s\n' "${ALL_VARS[@]}" | grep -qx "$VAR"; then
    UNUSED_VARS+=("$VAR")
  fi
done
```

Report format:

```
REDUNDANCY REPORT — Variables configured but NOT used in code:
──────────────────────────────────────────────────────────────
  OLD_API_KEY       configured in: .env.local (possibly stale)
  STRIPE_SECRET_KEY configured in: .env.local (payment removed?)

Total unused: 2
Action: Review and remove if no longer needed.
```

### Client-Side Exposure Audit

For each `CLIENT_VAR` (those with `NEXT_PUBLIC_` or `VITE_` prefix), check whether the variable holds a value that should never be client-side:

```bash
EXPOSURE_RISKS=()

# These patterns should NEVER appear with a client-side prefix
DANGEROUS_PATTERNS=(
  "SERVICE_ROLE"   # Supabase service role key — bypasses RLS
  "SECRET"         # Any key labelled "secret"
  "PRIVATE"        # Any key labelled "private"
  "WEBHOOK_SECRET" # Webhook signing secrets
  "ADMIN"          # Admin-level credentials
)

for VAR in "${CLIENT_VARS[@]}"; do
  for PATTERN in "${DANGEROUS_PATTERNS[@]}"; do
    if echo "$VAR" | grep -qi "$PATTERN"; then
      EXPOSURE_RISKS+=("$VAR")
    fi
  done
done
```

```
CLIENT-SIDE EXPOSURE RISKS:
────────────────────────────────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY  ← CRITICAL: Service role key must NEVER be client-side.
                                           Remove NEXT_PUBLIC_ prefix and use server-side only.

  NEXT_PUBLIC_RESEND_API_KEY             ← HIGH: API keys should not be client-side.
                                           Use a server-side API route to send emails instead.
```

See `references/client-side-risks.md` for the full risk table and remediation patterns.

---

## Step 4 — Generate `.env.local.template`

Create a template file with every variable that is used in code, grouped by service. Values are always empty — templates never contain real values.

```typescript
// Template generation logic
const template = buildEnvTemplate({
  vars: allVars,
  groupBy: 'service',   // group by detected service (Supabase, Anthropic, etc.)
  includeComments: true,
})
```

### Template Format

```bash
# .env.local.template
# Generated by env-var-audit skill — {date}
# Copy to .env.local and fill in values. Never commit .env.local.
#
# ── Supabase ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ── Anthropic ─────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=

# ── Resend ────────────────────────────────────────────────────────────────────
RESEND_API_KEY=
RESEND_FROM_ADDRESS=

# ── App Config ────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=

# ── Test (not used in production) ────────────────────────────────────────────
# TEST_USER_EMAIL=
# TEST_USER_PASSWORD=
```

See `references/env-grouping-patterns.md` for the full service → variable group mapping.

Write this file to the project root as `.env.local.template`. If the file already exists, diff it against the newly generated one and report additions/removals.

### Gitignore Check

Verify `.gitignore` contains the necessary exclusions:

```bash
GITIGNORE_NEEDED=(".env.local" ".env.*.local" ".env.production")
for ENTRY in "${GITIGNORE_NEEDED[@]}"; do
  if ! grep -qF "$ENTRY" .gitignore 2>/dev/null; then
    echo "WARNING: $ENTRY is not in .gitignore — add it to prevent accidental commit"
  fi
done
```

---

## Step 5 — Generate Startup Validation Function

Generate a validation function that runs at app startup and throws a clear error if any required variable is missing. This prevents silent failures where the app starts but behaves incorrectly due to missing config.

Write to `lib/config/validate-env.ts`:

```typescript
// lib/config/validate-env.ts
// Auto-generated by env-var-audit skill
// Re-run the skill to update this file when env vars change.

/**
 * Validates that all required environment variables are present.
 * Call this at application startup (e.g., in app/layout.tsx or instrumentation.ts).
 * Throws with a clear message listing every missing variable.
 */

interface EnvVar {
  name: string
  required: boolean
  serverOnly: boolean
  description: string
}

const ENV_VARS: EnvVar[] = [
  // ── Supabase ────────────────────────────────────────────────────
  {
    name: 'NEXT_PUBLIC_SUPABASE_URL',
    required: true,
    serverOnly: false,
    description: 'Supabase project URL',
  },
  {
    name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    required: true,
    serverOnly: false,
    description: 'Supabase anonymous key for client-side access',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    required: true,
    serverOnly: true,
    description: 'Supabase service role key — server-side only',
  },
  // ── Anthropic ───────────────────────────────────────────────────
  {
    name: 'ANTHROPIC_API_KEY',
    required: true,
    serverOnly: true,
    description: 'Anthropic API key for Claude',
  },
  // ── Resend ──────────────────────────────────────────────────────
  {
    name: 'RESEND_API_KEY',
    required: true,
    serverOnly: true,
    description: 'Resend API key for email sending',
  },
  // Add more variables as needed
]

export function validateEnv(): void {
  const isServer = typeof window === 'undefined'
  const missing: string[] = []

  for (const envVar of ENV_VARS) {
    // Skip server-only vars when running in the browser
    if (envVar.serverOnly && !isServer) continue

    const value = process.env[envVar.name]
    if (envVar.required && (!value || value.trim() === '')) {
      missing.push(`  ${envVar.name} — ${envVar.description}`)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.join('\n')}\n\n` +
      `Copy .env.local.template to .env.local and fill in the missing values.`
    )
  }
}

/**
 * Type-safe environment variable accessor.
 * Throws if the variable is missing at call time.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `Required environment variable ${name} is not set. ` +
      `Check .env.local and .env.local.template.`
    )
  }
  return value
}
```

### Wiring the Validation

For Next.js App Router, call `validateEnv()` in `instrumentation.ts` (runs once at server startup):

```typescript
// instrumentation.ts (Next.js 14+)
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./lib/config/validate-env')
    validateEnv()
  }
}
```

For Next.js Pages Router or other frameworks, call it in the server entry point:

```typescript
// pages/_app.tsx or app/layout.tsx (server component)
import { validateEnv } from '@/lib/config/validate-env'
if (typeof window === 'undefined') {
  validateEnv()
}
```

---

## Step 6 — Full Audit Summary

```
============================================================
Environment Variable Audit — {app-name}
============================================================
Scanned:     {n} files, {m} unique variable references found

MISSING (must be added before app will function):
  {list}

REDUNDANT (configured but unused — consider removing):
  {list}

CLIENT-SIDE EXPOSURE RISKS:
  {list or "None found"}

GITIGNORE:  {OK / WARNINGS}

Generated:
  ✓ .env.local.template
  ✓ lib/config/validate-env.ts
  ✓ instrumentation.ts wiring (or manual step required)

Next steps:
  1. cp .env.local.template .env.local
  2. Fill in missing values in .env.local
  3. Re-run audit: claude -p "run env-var-audit"
============================================================
```

---

## References

- `references/service-detection-patterns.md` — How to identify which service each variable belongs to
- `references/client-side-risks.md` — Full table of variables that must never be client-side
- `references/env-grouping-patterns.md` — Service → variable group mapping for template generation
