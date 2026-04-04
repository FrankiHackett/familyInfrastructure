# Service Detection Patterns

How to identify which external service each environment variable belongs to, based on variable name and usage context. Used by the env-var-audit skill to group variables in the generated template.

---

## Detection Method

Two-pass detection:

**Pass 1 — Name-based:** Match the variable name against known patterns.
**Pass 2 — Context-based:** Look at the import/package that uses the variable (more accurate for ambiguous names).

---

## Known Service Patterns

### Supabase

| Variable Pattern | Category |
|---|---|
| `*SUPABASE_URL*` | Supabase connection |
| `*SUPABASE_ANON_KEY*` | Supabase client auth |
| `*SUPABASE_SERVICE_ROLE_KEY*` | Supabase admin (server-only) |
| `*SUPABASE_JWT_SECRET*` | Supabase JWT validation (server-only) |
| `*SUPABASE_DB_URL*` | Direct Postgres connection |

Context signals: `from '@supabase/supabase-js'`, `createClient`, `supabase.from(`

### Anthropic / Claude

| Variable Pattern | Category |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic auth |
| `ANTHROPIC_BASE_URL` | Anthropic custom endpoint |
| `CLAUDE_MODEL` | Model override config |

Context signals: `from '@anthropic-ai/sdk'`, `from 'anthropic'`, `Anthropic(`, `messages.create`

### OpenAI

| Variable Pattern | Category |
|---|---|
| `OPENAI_API_KEY` | OpenAI auth |
| `OPENAI_BASE_URL` | OpenAI custom endpoint |
| `OPENAI_ORG_ID` | Organisation ID |

Context signals: `from 'openai'`, `OpenAI(`, `chat.completions.create`

### Resend

| Variable Pattern | Category |
|---|---|
| `RESEND_API_KEY` | Resend auth |
| `RESEND_FROM_ADDRESS` | Default sender address |
| `RESEND_FROM_NAME` | Default sender name |

Context signals: `from 'resend'`, `Resend(`, `emails.send`

### Stripe

| Variable Pattern | Category |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe server-side key |
| `STRIPE_PUBLISHABLE_KEY` | Stripe client-side key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe client-side key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `STRIPE_PRICE_ID_*` | Product price IDs |

Context signals: `from 'stripe'`, `Stripe(`, `stripe.checkout`, `stripe.webhooks.constructEvent`

### Cloudflare

| Variable Pattern | Category |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API auth |
| `CLOUDFLARE_ACCOUNT_ID` | Account identifier |
| `CLOUDFLARE_ZONE_ID` | Zone identifier |
| `CF_*` | Cloudflare Workers env vars |

Context signals: Direct `fetch` to `api.cloudflare.com`

### Vercel

| Variable Pattern | Category |
|---|---|
| `VERCEL_URL` | Auto-set by Vercel platform |
| `VERCEL_ENV` | `production`/`preview`/`development` |
| `NEXT_PUBLIC_VERCEL_URL` | Client-accessible deployment URL |

Note: `VERCEL_*` vars are injected automatically — they should NOT appear in `.env.local.template`.

### App-Level Config

| Variable Pattern | Category |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public app URL |
| `NEXT_PUBLIC_APP_NAME` | App display name |
| `NODE_ENV` | Runtime environment |
| `PORT` | Server port |
| `APP_SECRET` | App-level signing secret |

---

## Grouping Algorithm

When multiple variables belong to the same service, group them under a comment header in the template:

```
Priority order within each group:
1. Required client-side vars (NEXT_PUBLIC_*)
2. Required server-side vars
3. Optional server-side vars (commented out)
```

```bash
# Pseudocode for grouping
for SERVICE in Supabase Anthropic Resend Stripe Cloudflare "App Config" Other; do
  VARS_FOR_SERVICE=$(match_vars_to_service "$SERVICE" "$ALL_VARS")
  if [ -n "$VARS_FOR_SERVICE" ]; then
    echo ""
    echo "# ── $SERVICE ──────────────────────────────────────────────────────────────────"
    for VAR in $VARS_FOR_SERVICE; do
      if is_optional "$VAR"; then
        echo "# $VAR="
      else
        echo "$VAR="
      fi
    done
  fi
done
```

---

## Detecting Optional vs Required

A variable is considered **optional** if:
- It has a nullish coalescing fallback in the code: `process.env.VAR ?? 'default'`
- It has an `||` fallback: `process.env.VAR || 'default'`
- It is only used inside an `if` guard: `if (process.env.VAR) { ... }`

A variable is considered **required** if:
- It is used without a fallback
- It is passed directly to a constructor or function
- It is validated in a startup check

```bash
# Grep for optional usage patterns
grep -n "process\.env\.$VAR\s*[|?][|?]" "$FILE"    # has fallback
grep -n "process\.env\.$VAR\s*&&" "$FILE"            # conditional use
grep -n "if.*process\.env\.$VAR" "$FILE"             # guarded use

# If none found, treat as required
```

---

## Unknown Variables

Variables that don't match any known service pattern go in an "App Config" or "Other" group. Flag them for manual review:

```
UNRECOGNISED VARIABLE:
  MY_CUSTOM_VAR    used in: lib/custom.ts:12
  Action: Manually add description to .env.local.template comment
```
