# Cloudflare API Patterns

Reference for the access-protection skill. All API calls use Bearer token auth. All identifiers are read from config at runtime.

---

## Authentication

All Cloudflare API requests use:
```
Authorization: Bearer {CF_API_TOKEN}
Content-Type: application/json
```

The token requires these minimum permissions:
- `Zone:DNS:Edit` — to create/update DNS records
- `Account:Cloudflare Access: Apps and Policies:Edit` — to create Access applications and attach policies

---

## Base URLs

```
Zone-scoped:    https://api.cloudflare.com/client/v4/zones/{zone_id}/...
Account-scoped: https://api.cloudflare.com/client/v4/accounts/{account_id}/...
```

- DNS records are zone-scoped
- Access applications and policies are account-scoped

---

## DNS Records API

### List DNS Records (GET)

```
GET /client/v4/zones/{zone_id}/dns_records
```

Query parameters:
- `type=CNAME` — filter by record type
- `name={subdomain}` — filter by exact name (e.g., `triathlon.example.com`)
- `per_page=100` — increase page size (default 20)

Response shape:
```json
{
  "success": true,
  "result": [
    {
      "id": "record-uuid",
      "type": "CNAME",
      "name": "triathlon.example.com",
      "content": "my-app.vercel.app",
      "proxied": true,
      "ttl": 1,
      "created_on": "2024-01-01T00:00:00Z",
      "modified_on": "2024-01-01T00:00:00Z"
    }
  ],
  "result_info": { "count": 1, "total_count": 1 }
}
```

### Create DNS Record (POST)

```
POST /client/v4/zones/{zone_id}/dns_records
```

Request body:
```json
{
  "type": "CNAME",
  "name": "triathlon.example.com",
  "content": "my-app-abc123.vercel.app",
  "proxied": true,
  "ttl": 1,
  "comment": "Household App Infrastructure: triathlon app — created by access-protection skill"
}
```

Field notes:
- `proxied: true` — **required** for Cloudflare Access to intercept traffic
- `ttl: 1` — means "automatic" when proxied
- `comment` — optional, useful for audit trail (max 100 chars)

### Update DNS Record (PUT)

```
PUT /client/v4/zones/{zone_id}/dns_records/{record_id}
```

Same body format as Create. Replaces the entire record.

### Delete DNS Record (DELETE)

```
DELETE /client/v4/zones/{zone_id}/dns_records/{record_id}
```

Used during rollback if Access application creation fails.

---

## Cloudflare Access Applications API

### List Access Applications (GET)

```
GET /client/v4/accounts/{account_id}/access/apps
```

Response:
```json
{
  "success": true,
  "result": [
    {
      "id": "app-uuid",
      "name": "triathlon",
      "domain": "triathlon.example.com",
      "type": "self_hosted",
      "session_duration": "24h",
      "policies": [
        { "id": "policy-uuid", "precedence": 1 }
      ]
    }
  ]
}
```

### Create Access Application (POST)

```
POST /client/v4/accounts/{account_id}/access/apps
```

Request body — full field reference:

```json
{
  "name": "triathlon",
  "domain": "triathlon.example.com",
  "type": "self_hosted",

  "session_duration": "24h",
  "auto_redirect_to_identity": true,

  "http_only_cookie_attribute": true,
  "same_site_cookie_attribute": "lax",
  "skip_interstitial": false,

  "app_launcher_visible": true,
  "logo_url": "",

  "allowed_idps": [],
  "custom_deny_message": "",
  "custom_deny_url": "",
  "enable_binding_cookie": false,

  "cors_headers": null,
  "tags": ["household-app-infrastructure"]
}
```

| Field | Notes |
|---|---|
| `type` | Always `"self_hosted"` for Household App Infrastructure apps |
| `session_duration` | Options: `"30m"`, `"6h"`, `"12h"`, `"24h"`, `"168h"` (1 week), `"720h"` (30 days) |
| `auto_redirect_to_identity` | Skip the Access landing page and go straight to IdP login |
| `http_only_cookie_attribute` | Prevents JS from reading the Access cookie (recommended) |
| `same_site_cookie_attribute` | `"lax"` allows cross-site navigation, `"strict"` is more restrictive |
| `skip_interstitial` | `false` = show "You are being redirected" page; `true` = skip it |
| `app_launcher_visible` | Show in the Access App Launcher portal |

### Delete Access Application (DELETE)

```
DELETE /client/v4/accounts/{account_id}/access/apps/{app_id}
```

Used during rollback.

---

## Cloudflare Access Policies API

### List Policies for an App (GET)

Read policies from the app object itself — the `/policies` sub-endpoint does not support reusable policy references correctly:

```
GET /client/v4/accounts/{account_id}/access/apps/{app_id}
```

Policies are in `result.policies` as `[{ id, precedence }]`.

### Attach a Reusable Policy to an App (PUT)

Use PUT on the app itself with a `policies` array — do NOT POST to the `/policies` sub-endpoint, which only handles inline policies and rejects requests missing `include` rules. PATCH is not supported for this authentication scheme.

GET the app first, then PUT the full object back with the `policies` field set — a partial body will overwrite other app settings:

```
GET /client/v4/accounts/{account_id}/access/apps/{app_id}
PUT /client/v4/accounts/{account_id}/access/apps/{app_id}
```

Request body:
```json
{
  "policies": [{ "id": "{CF_ACCESS_POLICY_ID}", "precedence": 1 }]
}
```

`precedence: 1` means this is the first (and typically only) policy evaluated.

### Create an Inline Policy (POST) — Alternative

If the household doesn't use a reusable policy, create an inline one:

```json
{
  "name": "Household Members",
  "decision": "allow",
  "precedence": 1,
  "include": [
    {
      "email": { "email": "member@example.com" }
    }
  ],
  "require": [],
  "exclude": []
}
```

Do not use inline policies — always use the reusable policy from config to maintain a single source of truth for who has household access.

---

## Error Codes

| Code | Meaning | Action |
|---|---|---|
| `10000` | Authentication error — bad token | Check `cloudflare.api_token` in config |
| `10001` | Token missing required permission | Re-check token permissions |
| `81053` | DNS record already exists | Skip creation or update existing |
| `7003` | Resource not found | Check zone_id or account_id |
| `7000` | No route for request | Check URL construction |
| `1001` | Invalid request | Check request body with `jq .errors` |

### Checking Errors in Shell

```bash
SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
if [ "$SUCCESS" != "true" ]; then
  echo "$RESPONSE" | jq -r '.errors[] | "  Code \(.code): \(.message)"'
  exit 1
fi
```

---

## Pagination

For accounts with many Access apps or DNS records, paginate:

```bash
PAGE=1
ALL_APPS=()

while true; do
  RESPONSE=$(curl -s -X GET \
    "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/access/apps?per_page=100&page=${PAGE}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json")

  RESULTS=$(echo "$RESPONSE" | jq '.result')
  TOTAL=$(echo "$RESPONSE" | jq '.result_info.total_count')
  CURRENT_COUNT=$(echo "$RESPONSE" | jq '.result_info.count')

  ALL_APPS+=($RESULTS)

  [ "$CURRENT_COUNT" -lt 100 ] && break
  PAGE=$((PAGE + 1))
done
```

---

## Rate Limits

Cloudflare API rate limits for paid plans:
- DNS: 1200 requests per 5 minutes per zone
- Access: 1000 requests per 5 minutes per account

For the access-protection skill (5–8 API calls per run), rate limits are not a concern.
