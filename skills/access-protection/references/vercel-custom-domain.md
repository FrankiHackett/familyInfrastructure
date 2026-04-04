# Vercel Custom Domain Reference

How Vercel custom domain verification works, and how it interacts with Cloudflare proxied DNS.

---

## How Vercel Verifies Custom Domains

Vercel verifies domain ownership via DNS. The verification process depends on whether the domain is proxied through Cloudflare.

### With Cloudflare Proxied CNAME (Household App Infrastructure Standard)

When the CNAME is proxied (orange cloud), Vercel cannot see the raw CNAME value — it sees Cloudflare's edge IPs instead. Vercel handles this by:

1. Vercel assigns the domain when you add it in the dashboard
2. Vercel sends a request to the domain and checks for a verification token in the response headers
3. Cloudflare forwards the request to the Vercel origin
4. Vercel sees the request arrive and marks the domain as verified

This means **adding the domain in Vercel is required** even though the DNS record is already created. The CNAME alone is not enough — Vercel must also be told to accept traffic for that hostname.

### Timeline

| Step | Duration |
|---|---|
| CNAME created in Cloudflare | Instant |
| Vercel domain added | Manual step |
| Vercel verification | 1–5 minutes |
| SSL certificate issued by Vercel | 2–10 minutes after verification |
| Full end-to-end working | ~15 minutes from CNAME creation |

---

## Adding a Custom Domain in Vercel — Step by Step

### Via Vercel Dashboard (Recommended for Household App Infrastructure)

1. Open [vercel.com](https://vercel.com) → your project
2. Click **Settings** → **Domains**
3. Enter the subdomain: `{app-name}.{household-domain}`
4. Click **Add**
5. Vercel shows DNS configuration requirements — these are already satisfied by the Cloudflare CNAME
6. Wait for the green checkmark (typically 1–3 minutes)

### Via Vercel CLI

```bash
# Requires Vercel CLI and authentication
npx vercel domains add {app-name}.{household-domain} --project {project-name}
```

### Via Vercel API

If automating the full deployment flow, add the domain via API after the Cloudflare setup:

```bash
# Vercel API token — read from env or config, never hardcoded
VERCEL_TOKEN=$(jq -r '.vercel.api_token // empty' "$HOME/.bootstrap-config.json")
VERCEL_PROJECT_ID=$(jq -r '.vercel.project_id // empty' "$HOME/.bootstrap-config.json")

if [ -n "$VERCEL_TOKEN" ] && [ -n "$VERCEL_PROJECT_ID" ]; then
  VERCEL_RESPONSE=$(curl -s -X POST \
    "https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/domains" \
    -H "Authorization: Bearer ${VERCEL_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$(jq -n --arg domain "$SUBDOMAIN" '{name: $domain}')")

  VERCEL_SUCCESS=$(echo "$VERCEL_RESPONSE" | jq -r '.name // empty')
  if [ -n "$VERCEL_SUCCESS" ]; then
    echo "Domain added to Vercel: $VERCEL_SUCCESS"
  else
    echo "Vercel domain add response:"
    echo "$VERCEL_RESPONSE" | jq '.error // .'
  fi
else
  echo "Vercel API token not in config — add domain manually in Vercel dashboard."
  echo "  Project: $VERCEL_URL"
  echo "  Domain:  $SUBDOMAIN"
fi
```

If `vercel.api_token` and `vercel.project_id` are not in `~/.bootstrap-config.json`, this step falls back to a manual instruction. The skill does not hard-block on this — Cloudflare Access is the security control, not Vercel domain configuration.

---

## SSL / TLS Configuration

### Vercel SSL

Vercel automatically provisions a TLS certificate for the custom domain after verification. No action needed. The certificate covers exactly the subdomain added (not a wildcard unless you add `*.household-domain`).

### Cloudflare SSL

Because the DNS is proxied, there are two TLS connections:
1. **Browser → Cloudflare edge:** Secured by Cloudflare's certificate (covers `*.household-domain`)
2. **Cloudflare edge → Vercel origin:** Secured by Vercel's certificate

Cloudflare SSL mode should be set to **Full (strict)** in the Cloudflare dashboard to validate Vercel's certificate on the origin connection. This is the recommended setting for Household App Infrastructure apps.

To check the current SSL mode via API:
```bash
curl -s "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/settings/ssl" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.result.value'
```

Expected value: `"full"` or `"strict"`. If `"flexible"` or `"off"`, traffic between Cloudflare and Vercel is unencrypted — flag this to the user.

---

## Vercel Origin Protection

The `.vercel.app` URL is publicly accessible by default. After setting up Cloudflare Access, two approaches prevent direct origin access:

### Option 1: Vercel Password Protection (Vercel Pro)

Requires Vercel Pro plan. Adds HTTP Basic Auth to the Vercel origin. Not recommended — adds friction and doesn't integrate with Access.

### Option 2: Middleware-Based Origin Check (Recommended)

Add origin verification in `middleware.ts` — checks for the Cloudflare Access header. See `access-policy-model.md` for the implementation.

### Option 3: Vercel Trusted IPs

Restrict Vercel to only accept traffic from Cloudflare's IP ranges. Cloudflare publishes their IP ranges at:
- IPv4: `https://www.cloudflare.com/ips-v4`
- IPv6: `https://www.cloudflare.com/ips-v6`

This is infrastructure-level protection but requires Vercel Enterprise for IP allowlisting.

For Household App Infrastructure household apps, **Option 2 (middleware check)** is the practical recommendation.

---

## Debugging Custom Domain Issues

### Domain Shows "Invalid Configuration" in Vercel

Cause: Vercel can't verify the domain.

Check:
1. DNS record is proxied (orange cloud) in Cloudflare
2. Record points to the correct `*.vercel.app` target
3. No redirect loop between Cloudflare and Vercel

```bash
# Test the CNAME resolution (unproxied view via dig)
dig CNAME {app-name}.{household-domain}

# Test the HTTP response
curl -I https://{app-name}.{household-domain}
```

### Access Policy Not Triggering

Cause: DNS record is not proxied, or Access application domain doesn't match the subdomain exactly.

Check:
1. DNS record `proxied: true` — `curl` the Cloudflare DNS API to verify
2. Access application `domain` field matches the CNAME `name` exactly (including full domain)

### SSL Certificate Error

Cause: SSL mode is not "Full" or "Full (strict)".

Check Cloudflare SSL setting in dashboard: **SSL/TLS → Overview → SSL/TLS encryption mode**.

Should be **Full (strict)** for Household App Infrastructure apps.
