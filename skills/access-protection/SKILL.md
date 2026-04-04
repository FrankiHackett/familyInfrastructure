---
name: access-protection
description: This skill should be used when the user asks to "set up Cloudflare Access", "protect a new app", "add access control", "configure a subdomain", "point a new app at the household domain", "publish an app behind access", or is deploying a new Household App Infrastructure app that needs to be gated behind the household Cloudflare Access policy. Configures Cloudflare Access for a new Vercel-deployed app, creates the subdomain DNS record, applies the existing household access policy, and returns the protected subdomain URL.
version: 1.0.0
allowed-tools: [Read, Glob, Grep, Bash]
---

# Access Protection

Configures Cloudflare Access for a new Household App Infrastructure app. Creates a CNAME pointing the household subdomain at the Vercel deployment, creates a Cloudflare Access Application scoped to that subdomain, and applies the existing household access policy. Returns the final protected URL.

All Cloudflare identifiers, the household domain, and the API token are read from `~/.bootstrap-config.json` at runtime. No values from that file ever appear in this skill.

## When This Skill Applies

Activate when the user:
- Is deploying a new Household App Infrastructure app to Vercel and wants it behind Access
- Asks to configure a subdomain on the household domain
- Wants to apply the existing household access policy to a new app
- Asks for the protected URL for a newly deployed app

---

## Required Inputs

Before proceeding, confirm:

1. **App name** — used as the subdomain (e.g., `triathlon` → `triathlon.{household-domain}`)
2. **Vercel deployment URL** — the `*.vercel.app` URL (or custom Vercel URL) of the app

If either is missing, ask before proceeding.

---

## Critical Rule

All Cloudflare identifiers, the household domain, and the access policy ID must be read from `~/.bootstrap-config.json` at runtime. They must never appear as literals in this skill, in generated scripts, or in any output that could be committed to a repository.

---

## Step 1 — Load Config

```bash
CONFIG_FILE="$HOME/.bootstrap-config.json"

# Guard: config must exist
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: ~/.bootstrap-config.json not found."
  echo "Configure Cloudflare credentials in the config file before running this skill."
  exit 1
fi

# Guard: jq must be available
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required. Install with: brew install jq"
  exit 1
fi

# Read all Cloudflare config — stored in variables only, never logged
CF_ACCOUNT_ID=$(jq -r '.cloudflare.account_id' "$CONFIG_FILE")
CF_ZONE_ID=$(jq -r '.cloudflare.zone_id' "$CONFIG_FILE")
CF_HOUSEHOLD_DOMAIN=$(jq -r '.cloudflare.household_domain' "$CONFIG_FILE")
CF_ACCESS_POLICY_ID=$(jq -r '.cloudflare.access_policy_id' "$CONFIG_FILE")
CF_API_TOKEN=$(jq -r '.cloudflare.api_token' "$CONFIG_FILE")

# Validate all required fields are present and non-null
REQUIRED_FIELDS=(
  "cloudflare.account_id:CF_ACCOUNT_ID"
  "cloudflare.zone_id:CF_ZONE_ID"
  "cloudflare.household_domain:CF_HOUSEHOLD_DOMAIN"
  "cloudflare.access_policy_id:CF_ACCESS_POLICY_ID"
  "cloudflare.api_token:CF_API_TOKEN"
)

CONFIG_VALID=true
for FIELD_PAIR in "${REQUIRED_FIELDS[@]}"; do
  FIELD_PATH="${FIELD_PAIR%%:*}"
  VAR_NAME="${FIELD_PAIR##*:}"
  VAR_VALUE="${!VAR_NAME}"

  if [ -z "$VAR_VALUE" ] || [ "$VAR_VALUE" = "null" ]; then
    echo "ERROR: Missing required config field: $FIELD_PATH"
    CONFIG_VALID=false
  fi
done

[ "$CONFIG_VALID" = false ] && exit 1

echo "Config loaded. Household domain: $CF_HOUSEHOLD_DOMAIN"
```

The household domain is safe to echo as it is not a secret — it is the user-facing domain. All other values are kept in shell variables only.

---

## Step 2 — Derive Subdomain and Target URL

```bash
# APP_NAME and VERCEL_URL are provided by the user
# APP_NAME = e.g. "triathlon"
# VERCEL_URL = e.g. "my-app-abc123.vercel.app"

SUBDOMAIN="${APP_NAME}.${CF_HOUSEHOLD_DOMAIN}"

echo "Target subdomain: $SUBDOMAIN"
echo "Vercel deployment: $VERCEL_URL"
```

---

## Step 3 — Check for Existing DNS Record

Before creating anything, check whether the DNS record already exists to avoid duplicates.

```bash
EXISTING_RECORD=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=CNAME&name=${SUBDOMAIN}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

RECORD_COUNT=$(echo "$EXISTING_RECORD" | jq '.result | length')

if [ "$RECORD_COUNT" -gt 0 ]; then
  EXISTING_TARGET=$(echo "$EXISTING_RECORD" | jq -r '.result[0].content')
  EXISTING_ID=$(echo "$EXISTING_RECORD" | jq -r '.result[0].id')
  echo "DNS record already exists for $SUBDOMAIN → $EXISTING_TARGET"

  if [ "$EXISTING_TARGET" = "$VERCEL_URL" ]; then
    echo "Record already points to correct target. Skipping DNS creation."
    DNS_RECORD_ID="$EXISTING_ID"
    DNS_CREATED=false
  else
    echo "WARNING: Record points to a different target: $EXISTING_TARGET"
    echo "Expected: $VERCEL_URL"
    echo "Update the record? [y/N]:"
    read -r CONFIRM
    [ "$CONFIRM" != "y" ] && echo "Aborted." && exit 1
    # Will update below
    DNS_RECORD_ID="$EXISTING_ID"
    DNS_CREATED=false
    UPDATE_DNS=true
  fi
else
  DNS_CREATED=true
fi
```

---

## Step 4 — Create or Update DNS CNAME Record

See `references/cloudflare-api-patterns.md` for full API reference.

### Create New Record

```bash
if [ "$DNS_CREATED" = true ]; then
  DNS_RESPONSE=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$(jq -n \
      --arg type "CNAME" \
      --arg name "$SUBDOMAIN" \
      --arg content "$VERCEL_URL" \
      --argjson proxied true \
      --argjson ttl 1 \
      '{type: $type, name: $name, content: $content, proxied: $proxied, ttl: $ttl}'
    )")

  DNS_SUCCESS=$(echo "$DNS_RESPONSE" | jq -r '.success')

  if [ "$DNS_SUCCESS" != "true" ]; then
    ERRORS=$(echo "$DNS_RESPONSE" | jq -r '.errors[].message')
    echo "ERROR: Failed to create DNS record."
    echo "  $ERRORS"
    exit 1
  fi

  DNS_RECORD_ID=$(echo "$DNS_RESPONSE" | jq -r '.result.id')
  echo "DNS CNAME created: $SUBDOMAIN → $VERCEL_URL (proxied)"
fi
```

### Update Existing Record

```bash
if [ "${UPDATE_DNS:-false}" = true ]; then
  UPDATE_RESPONSE=$(curl -s -X PUT \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${DNS_RECORD_ID}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$(jq -n \
      --arg type "CNAME" \
      --arg name "$SUBDOMAIN" \
      --arg content "$VERCEL_URL" \
      --argjson proxied true \
      --argjson ttl 1 \
      '{type: $type, name: $name, content: $content, proxied: $proxied, ttl: $ttl}'
    )")

  UPDATE_SUCCESS=$(echo "$UPDATE_RESPONSE" | jq -r '.success')
  [ "$UPDATE_SUCCESS" != "true" ] && \
    echo "ERROR: DNS update failed." && \
    echo "$UPDATE_RESPONSE" | jq '.errors' && exit 1

  echo "DNS CNAME updated: $SUBDOMAIN → $VERCEL_URL"
fi
```

**Why `proxied: true`:** Cloudflare proxied mode is required for Access to intercept requests. Without it, Cloudflare Access cannot enforce the policy.

---

## Step 5 — Check for Existing Access Application

```bash
EXISTING_APP=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

# Check if an app already exists for this subdomain
EXISTING_APP_ID=$(echo "$EXISTING_APP" | \
  jq -r --arg domain "$SUBDOMAIN" \
  '.result[] | select(.domain == $domain) | .id' | head -1)

if [ -n "$EXISTING_APP_ID" ]; then
  echo "Access application already exists for $SUBDOMAIN (id: $EXISTING_APP_ID)"
  echo "Skipping Access application creation."
  ACCESS_APP_ID="$EXISTING_APP_ID"
  ACCESS_CREATED=false
else
  ACCESS_CREATED=true
fi
```

---

## Step 6 — Create Cloudflare Access Application

```bash
if [ "$ACCESS_CREATED" = true ]; then
  ACCESS_APP_RESPONSE=$(curl -s -X POST \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$(jq -n \
      --arg name "$APP_NAME" \
      --arg domain "$SUBDOMAIN" \
      --arg session_duration "24h" \
      '{
        name: $name,
        domain: $domain,
        type: "self_hosted",
        session_duration: $session_duration,
        auto_redirect_to_identity: true,
        http_only_cookie_attribute: true,
        same_site_cookie_attribute: "lax",
        skip_interstitial: false,
        app_launcher_visible: true
      }'
    )")

  ACCESS_SUCCESS=$(echo "$ACCESS_APP_RESPONSE" | jq -r '.success')

  if [ "$ACCESS_SUCCESS" != "true" ]; then
    ERRORS=$(echo "$ACCESS_APP_RESPONSE" | jq -r '.errors[].message')
    echo "ERROR: Failed to create Access application."
    echo "  $ERRORS"
    echo "DNS record was created — you may need to clean it up manually."
    exit 1
  fi

  ACCESS_APP_ID=$(echo "$ACCESS_APP_RESPONSE" | jq -r '.result.id')
  echo "Access application created: $APP_NAME (id: $ACCESS_APP_ID)"
fi
```

See `references/cloudflare-api-patterns.md` for full Access application field reference.

---

## Step 7 — Apply Existing Access Policy

Attach the household's existing Access policy (loaded from config) to the new application.

```bash
POLICY_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${ACCESS_APP_ID}/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(jq -n \
    --arg policy_id "$CF_ACCESS_POLICY_ID" \
    --argjson precedence 1 \
    '{
      precedence: $precedence,
      reusable_policy_id: $policy_id
    }'
  )")

POLICY_SUCCESS=$(echo "$POLICY_RESPONSE" | jq -r '.success')

if [ "$POLICY_SUCCESS" != "true" ]; then
  ERRORS=$(echo "$POLICY_RESPONSE" | jq -r '.errors[].message')
  echo "ERROR: Failed to attach access policy."
  echo "  $ERRORS"
  echo "Access application was created but has no policy — users will be blocked."
  echo "Manually attach policy in Cloudflare dashboard."
  exit 1
fi

echo "Access policy applied to $APP_NAME."
```

---

## Step 8 — Verify and Return Result

```bash
# Final verification: confirm the Access app is active
VERIFY=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps/${ACCESS_APP_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json")

VERIFY_DOMAIN=$(echo "$VERIFY" | jq -r '.result.domain')
VERIFY_POLICY_COUNT=$(echo "$VERIFY" | jq -r '.result.policies | length')

PROTECTED_URL="https://${SUBDOMAIN}"

echo ""
echo "============================================================"
echo "Access Protection — Complete"
echo "============================================================"
echo "App:             $APP_NAME"
echo "Subdomain:       $SUBDOMAIN"
echo "Vercel target:   $VERCEL_URL"
echo "DNS record:      $([ "$DNS_CREATED" = true ] && echo 'Created' || echo 'Already existed')"
echo "Access app:      $([ "$ACCESS_CREATED" = true ] && echo 'Created' || echo 'Already existed')"
echo "Policies active: $VERIFY_POLICY_COUNT"
echo ""
echo "Protected URL: $PROTECTED_URL"
echo "============================================================"
echo ""
echo "Next steps:"
echo "  1. Add $SUBDOMAIN as a custom domain in your Vercel project"
echo "  2. Vercel will verify DNS automatically (CNAME is already set)"
echo "  3. Test access at: $PROTECTED_URL"
echo "  4. Verify policy blocks unauthenticated requests"
```

---

## Step 9 — Add Custom Domain in Vercel (Manual Step)

Cloudflare Access intercepts traffic at the Cloudflare edge, but Vercel must also recognise the custom domain to route the request correctly.

Instructions to provide to the user:

```
MANUAL STEP — Add custom domain in Vercel:

1. Open Vercel dashboard → your project → Settings → Domains
2. Add domain: {SUBDOMAIN}
3. Vercel will verify via the CNAME record (already created in Step 4)
4. Verification typically takes 1–2 minutes

After verification:
- Requests to https://{SUBDOMAIN} flow through Cloudflare Access
- Authenticated users are proxied to Vercel
- Unauthenticated requests are redirected to the Access login page
```

---

## Error Handling Summary

| Failure Point | What to Do |
|---|---|
| Config file missing | Exit with instructions to create it |
| DNS record creation fails | Exit before creating Access app |
| Access app creation fails | Exit, warn about orphaned DNS record |
| Policy attachment fails | Warn — app is live but unprotected; manual fix required |
| Verify shows 0 policies | Hard warning — do not use URL until fixed |

---

## References

- `references/cloudflare-api-patterns.md` — Cloudflare API endpoints, field reference, pagination, error codes
- `references/access-policy-model.md` — Cloudflare Access concepts, session duration, cookie settings, reusable policies
- `references/vercel-custom-domain.md` — How Vercel custom domain verification works, SSL provisioning timeline
