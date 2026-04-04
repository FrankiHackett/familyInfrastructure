# Client-Side Exposure Risks

Variables that are exposed client-side (via `NEXT_PUBLIC_` or `VITE_` prefix) are embedded in the JavaScript bundle sent to every user's browser. This reference defines what should and should not be client-side.

---

## Risk Levels

### CRITICAL — Must Never Be Client-Side

These variables give full admin or billing control over external services. If exposed, an attacker can read or modify all data, send emails from your domain, process payments, etc.

| Variable Pattern | Why It's Critical |
|---|---|
| `*SERVICE_ROLE_KEY*` | Supabase service role bypasses all RLS — full DB read/write |
| `*SECRET_KEY*` | Full API access (Stripe, etc.) |
| `*PRIVATE_KEY*` | Cryptographic or API private key |
| `*WEBHOOK_SECRET*` | Allows forging webhook payloads |
| `*JWT_SECRET*` | Allows forging JWTs |
| `ANTHROPIC_API_KEY` | Unlimited LLM spend on your account |
| `OPENAI_API_KEY` | Unlimited LLM spend on your account |
| `RESEND_API_KEY` | Send emails from your domain |
| `STRIPE_SECRET_KEY` | Full billing and payout control |
| `CLOUDFLARE_API_TOKEN` | Full DNS/access control |
| `SUPABASE_DB_URL` | Direct Postgres connection |

**Remediation:** Remove the `NEXT_PUBLIC_` or `VITE_` prefix. Move all usage of the variable to server-side API routes. Never pass these values through client-accessible props or API responses.

---

### HIGH — Should Not Be Client-Side

These variables don't give immediate admin access but reveal infrastructure details that aid attackers.

| Variable Pattern | Why It's High Risk |
|---|---|
| `*ADMIN*` | Admin-level endpoints or credentials |
| `*DATABASE_URL*` | Direct DB connection string |
| `*INTERNAL_*` | Internal service URLs or tokens |
| `*API_SECRET*` | Service-specific secret values |

**Remediation:** Same as CRITICAL — move to server-only. Use API routes as a proxy.

---

### LOW — Intentionally Client-Side

These are safe and expected to be in the browser bundle.

| Variable Pattern | Why It's Safe |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public project URL, not a secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key — RLS prevents abuse |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key — designed for browser |
| `NEXT_PUBLIC_APP_URL` | Your own app URL |
| `NEXT_PUBLIC_APP_NAME` | App display name |
| `NEXT_PUBLIC_VERCEL_URL` | Deployment URL |
| `VITE_PUBLIC_*` | Explicitly public Vite config |

Note on Supabase anon key: it is intentionally public but must be paired with correct RLS policies. An exposed anon key with no RLS is dangerous. See schema-generation skill for RLS policy templates.

---

## The Proxy Pattern

For any secret that the browser needs to trigger (e.g., sending an email, calling an LLM), use a server-side API route as a proxy:

**Before (unsafe):**
```typescript
// components/EmailButton.tsx — WRONG
import { Resend } from 'resend'
const resend = new Resend(process.env.NEXT_PUBLIC_RESEND_API_KEY)  // exposed!
```

**After (safe):**
```typescript
// components/EmailButton.tsx — correct
async function sendEmail(data: EmailData) {
  const res = await fetch('/api/send-email', {
    method: 'POST',
    body: JSON.stringify(data),
  })
  return res.json()
}

// app/api/send-email/route.ts — server-side only
import { Resend } from 'resend'
const resend = new Resend(process.env.RESEND_API_KEY)  // server-only, safe
```

The API route validates auth (via Supabase server client) before calling Resend.

---

## How the Audit Detects Exposure Risks

```bash
# Step 1: Find all client-prefixed vars in code
CLIENT_VARS=$(grep -rh 'process\.env\.NEXT_PUBLIC_[A-Z_]+' src/ app/ lib/ \
  | grep -oP 'NEXT_PUBLIC_[A-Z_]+' | sort -u)

# Step 2: Check each against the CRITICAL and HIGH risk patterns
for VAR in $CLIENT_VARS; do
  RISK="NONE"

  echo "$VAR" | grep -qiE '(SERVICE_ROLE|SECRET_KEY|PRIVATE_KEY|WEBHOOK|JWT_SECRET)' \
    && RISK="CRITICAL"

  echo "$VAR" | grep -qiE '(ADMIN|DATABASE_URL|INTERNAL|API_SECRET)' \
    && [ "$RISK" = "NONE" ] && RISK="HIGH"

  [ "$RISK" != "NONE" ] && echo "$RISK: $VAR"
done
```

---

## Browser Bundle Inspection

To verify what ends up in the client bundle after build:

```bash
# Next.js: search the build output for variable names
grep -r "NEXT_PUBLIC_" .next/static/chunks/ 2>/dev/null | grep -v '.map'

# Vite: inspect the built JS
grep -r "VITE_" dist/ 2>/dev/null
```

Any `NEXT_PUBLIC_` variable will have its **value** embedded in the bundle. Confirm the values in the bundle are not sensitive.

---

## Special Case: Supabase Anon Key

The Supabase anon key is intentionally public but carries a security assumption: **Row Level Security is enabled and correctly configured on every table.**

If RLS is disabled on any table (e.g., via `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`), the anon key gives full read access to that table.

Always verify RLS is enabled when using the anon key client-side:

```sql
-- Check RLS status for all tables in a schema
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'your_schema';
-- rowsecurity should be 't' (true) for every table
```
