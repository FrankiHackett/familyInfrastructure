# Cloudflare Access Policy Model

Conceptual reference for understanding how Cloudflare Access protects Household App Infrastructure apps.

---

## How Access Works

```
User → https://app.household-domain
         ↓
    Cloudflare Edge
    (proxied CNAME required)
         ↓
    Access Application check
    ─ Does a valid Access JWT cookie exist?
      YES → Forward request to Vercel origin
      NO  → Redirect to identity provider login
         ↓ (after successful login)
    Cloudflare issues Access JWT cookie
         ↓
    Request forwarded to Vercel
```

The DNS record **must** be proxied (orange cloud in Cloudflare) for Access to intercept. An unproxied CNAME bypasses Access entirely.

---

## Reusable Policies

Household App Infrastructure uses a single **reusable policy** applied to all apps. This means:
- Adding a new household member in one place automatically grants access to all apps
- No per-app policy maintenance
- The policy ID is stored in `~/.bootstrap-config.json` as `cloudflare.access_policy_id`

### Policy Structure

A typical household allow policy:

```json
{
  "name": "Household Members",
  "decision": "allow",
  "include": [
    {
      "email_domain": { "domain": "household-email-domain.com" }
    }
  ],
  "require": [],
  "exclude": []
}
```

Or with specific email addresses for mixed-provider households:

```json
{
  "name": "Household Members",
  "decision": "allow",
  "include": [
    { "email": { "email": "member1@provider1.com" } },
    { "email": { "email": "member2@provider2.com" } }
  ]
}
```

The actual policy content is managed in the Cloudflare dashboard — this skill only attaches the existing policy by ID, never modifies its rules.

---

## Session Duration

Sessions are scoped per Access Application. The default for Household App Infrastructure apps is `"24h"`.

| Duration | Use Case |
|---|---|
| `"30m"` | High-security admin tools |
| `"6h"` | Sensitive financial data |
| `"24h"` | Standard Household App Infrastructure apps (default) |
| `"168h"` | Low-sensitivity, frequently accessed apps |
| `"720h"` | Public-ish household tools with minimal risk |

After session expiry, users are redirected to re-authenticate with the identity provider. The IdP may have its own session (e.g., Google "stay signed in") so re-auth is often seamless.

---

## Cookie Settings

### `http_only_cookie_attribute: true`

Prevents JavaScript from reading the `CF_Authorization` cookie. Protects against XSS-based session theft. Always set to `true` for Household App Infrastructure apps.

### `same_site_cookie_attribute: "lax"`

- `"lax"` — cookie is sent on top-level navigation (clicking links) but not on cross-site subresource requests. Standard choice.
- `"strict"` — cookie is never sent on cross-site requests, including top-level navigations from other sites. More restrictive; can cause issues with redirects from other origins.
- `"none"` — cookie is always sent (requires HTTPS). Not recommended.

Use `"lax"` for all Household App Infrastructure apps unless there is a specific reason for `"strict"`.

---

## App Launcher

When `app_launcher_visible: true`, the app appears in the Cloudflare Access App Launcher at:
```
https://{team-name}.cloudflareaccess.com/
```

This gives household members a dashboard view of all protected apps. Recommended for all Household App Infrastructure apps.

---

## `auto_redirect_to_identity`

When `true`: users who hit the protected app without a valid session are redirected directly to the identity provider login page, bypassing the Access "one more step" interstitial page.

For Household App Infrastructure household apps where all users are known, set to `true` for a smoother login experience.

---

## What Access Does NOT Protect

Access only controls whether a user can reach the Vercel origin. It does not:
- Replace Supabase RLS — data access is still governed by database policies
- Protect API routes from direct calls with valid bearer tokens (if your app issues JWTs, those bypass Access)
- Prevent Vercel from being accessed via its `.vercel.app` URL directly

### Protect the Vercel Origin URL

To prevent users from bypassing Cloudflare Access by accessing the `.vercel.app` URL directly, configure Vercel to only accept requests that carry a Cloudflare Access JWT:

In your Next.js middleware or API routes, validate the `CF-Access-Authenticated-User-Email` header and the `CF_Authorization` JWT:

```typescript
// middleware.ts
import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  // In production on Vercel: verify Cloudflare Access JWT
  if (process.env.NODE_ENV === 'production') {
    const cfToken = req.cookies.get('CF_Authorization')?.value
    const cfEmail = req.headers.get('CF-Access-Authenticated-User-Email')

    // If neither header is present, this request bypassed Cloudflare Access
    if (!cfToken && !cfEmail) {
      // Redirect to the protected Cloudflare domain, not a 401
      const householdUrl = process.env.NEXT_PUBLIC_APP_URL
      if (householdUrl) {
        return NextResponse.redirect(householdUrl)
      }
      return new NextResponse('Access denied', { status: 403 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api/health|_next/static|_next/image|favicon.ico).*)'],
}
```

Note: Full JWT verification requires the Cloudflare Access public key (available from `https://{team}.cloudflareaccess.com/cdn-cgi/access/certs`). The header check above is a lightweight alternative — sufficient for household apps where the threat model is casual bypass rather than active attack.

---

## Rollback Procedure

If access-protection fails partway through:

1. **DNS created, Access app creation failed:**
   - Delete the DNS record: `DELETE /zones/{zone_id}/dns_records/{record_id}`
   - Subdomain will return NXDOMAIN until re-run

2. **Access app created, policy attachment failed:**
   - App is live but unprotected (all requests pass through)
   - Manually attach policy in Cloudflare dashboard immediately
   - Or delete the app and re-run the skill: `DELETE /accounts/{account_id}/access/apps/{app_id}`

3. **Vercel custom domain not added:**
   - Cloudflare proxies to Vercel, but Vercel returns 404 for unknown domains
   - Add the custom domain in Vercel dashboard — DNS verification succeeds immediately (CNAME already set)
