# Client Bundle Risks

Packages that must never be imported from client-side code. Importing them client-side either exposes secrets, bloats the bundle, or causes runtime errors (Node-only APIs in the browser).

---

## Risk Categories

### CRITICAL — Leaks Secrets or Credentials

These packages are instantiated with API keys. If imported client-side, the key will be embedded in the browser bundle.

| Package | Secret Risk | Correct Location |
|---|---|---|
| `anthropic` / `@anthropic-ai/sdk` | `ANTHROPIC_API_KEY` in bundle | API route only |
| `openai` | `OPENAI_API_KEY` in bundle | API route only |
| `resend` | `RESEND_API_KEY` in bundle | API route only |
| `stripe` (server import) | `STRIPE_SECRET_KEY` in bundle | API route only |
| `nodemailer` | SMTP credentials in bundle | API route only |

### HIGH — Node-Only APIs (Runtime Error in Browser)

These packages use Node.js built-ins that don't exist in the browser. They'll cause a runtime crash if imported client-side.

| Package | Node Dependency | Effect if Browser-Imported |
|---|---|---|
| `fs`, `node:fs` | Node `fs` module | `TypeError: fs is not defined` |
| `pg` / `postgres` / `@vercel/postgres` | Node `net` module | Runtime crash |
| `drizzle-orm` | Node DB drivers | Runtime crash |
| `sharp` | Native bindings | Runtime crash |
| `child_process` | Node `child_process` | Runtime crash |
| `crypto` (Node) | Node `crypto` | May work in modern browsers via Web Crypto, but incorrect usage |

### MEDIUM — Bundle Size Bloat

These packages have large footprints and are rarely needed client-side.

| Package | Approximate Size | Note |
|---|---|---|
| `@supabase/supabase-js` (service role) | Large | Service role client should stay server-side |
| `zod` (full validation) | ~60KB | Validation schemas belong server-side for API inputs |
| `date-fns` (full import) | ~75KB | Use tree-shaking: `import { format } from 'date-fns'` |
| `lodash` (full import) | ~70KB | Use tree-shaking: `import merge from 'lodash/merge'` |

---

## Detecting Client vs Server Files

### Next.js App Router Rules

A file is **client-side** if:
- It contains `'use client'` directive at the top
- It is imported (directly or transitively) from a file with `'use client'`

A file is **server-side** if:
- It has no directive (React Server Component by default in App Router)
- It contains `'use server'` directive
- It is named `route.ts` / `route.js` (API route handler)
- It is in `middleware.ts`
- It is in `instrumentation.ts`

### Detection Logic

```bash
is_client_file() {
  local FILE="$1"

  # Explicit 'use client' directive
  head -5 "$FILE" | grep -q "'use client'" && return 0

  # Files that are almost always client-side by convention
  case "$FILE" in
    */components/ui/*) return 0 ;;
    *\.stories\.tsx)   return 0 ;;
    *\.stories\.ts)    return 0 ;;
  esac

  # API routes are always server-side
  case "$FILE" in
    */app/api/*route.ts)    return 1 ;;
    */pages/api/*.ts)       return 1 ;;
    *instrumentation.ts)    return 1 ;;
    *middleware.ts)         return 1 ;;
  esac

  # Default: Next.js App Router files are server by default
  return 1
}
```

Note: This is a heuristic. True client/server boundary analysis requires tracing the import graph. For high-confidence detection, check for the `'use client'` directive explicitly.

---

## Remediation Patterns

### Pattern 1: Move to API Route

The most common fix. Replace the direct import with a `fetch` call to an API route.

**Before (client component):**
```typescript
'use client'
import Anthropic from '@anthropic-ai/sdk'
// WRONG: SDK + API key will be in browser bundle

export function AIChatButton() {
  const client = new Anthropic()  // Key exposed!
  const handleClick = async () => {
    const msg = await client.messages.create({ ... })
  }
}
```

**After:**
```typescript
// components/AIChatButton.tsx — client component
'use client'

export function AIChatButton() {
  const handleClick = async () => {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '...' }),
    })
    const data = await res.json()
  }
}

// app/api/ai/chat/route.ts — server-side only
import Anthropic from '@anthropic-ai/sdk'
const client = new Anthropic()  // process.env.ANTHROPIC_API_KEY used here

export async function POST(req: Request) {
  // Validate auth first
  const { message } = await req.json()
  const response = await client.messages.create({ ... })
  return Response.json({ content: response.content })
}
```

### Pattern 2: Use next/server-only Package

Add `import 'server-only'` at the top of files that must never be imported client-side. Next.js will throw a build-time error if they are.

```typescript
// lib/ai/client.ts
import 'server-only'  // Throws at build time if imported in a client component
import Anthropic from '@anthropic-ai/sdk'

export const anthropic = new Anthropic()
```

This requires the `server-only` package:
```bash
npm install server-only
```

### Pattern 3: Conditional Import (Server Components Only)

For utility functions that need to work in both environments, use dynamic imports:

```typescript
// Server Component (no 'use client' directive)
export default async function Page() {
  // Dynamic import is fine in server components
  const { generateReport } = await import('@/lib/reports/generator')
  const report = await generateReport()
  return <div>{report}</div>
}
```

---

## Build-Time Verification

After fixing bundle risks, verify the fix with Next.js build:

```bash
# Build and check bundle analysis
ANALYZE=true npm run build

# Or use @next/bundle-analyzer
npm install -D @next/bundle-analyzer
```

Check that server-only packages no longer appear in the client chunks.
