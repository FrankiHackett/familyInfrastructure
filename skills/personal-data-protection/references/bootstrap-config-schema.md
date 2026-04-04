# Bootstrap Config Schema

`~/.bootstrap-config.json` is the single source of truth for all personal and household values used across Household App Infrastructure skills. It is never committed to any repository.

## Required Fields for Personal Data Protection

```jsonc
{
  // Array of string values that belong to or identify the primary user.
  // These are exact-match scan targets in Pass 1.
  // Examples of what these might be (do not put real values here):
  //   - full name, first name, last name
  //   - email addresses
  //   - phone numbers
  //   - physical address components (street, city, postcode)
  //   - usernames or handles
  //   - national ID or membership numbers
  "personal_data_flags": [
    // populated at runtime — never hardcoded
  ],

  // Array of string values that belong to or identify the partner/household member.
  // Same format as personal_data_flags.
  "partner_personal_data_flags": [
    // populated at runtime — never hardcoded
  ]
}
```

## Full Config Shape (All Household App Infrastructure Skills)

```jsonc
{
  // ── Personal Data Protection ──────────────────────────────
  "personal_data_flags": [],
  "partner_personal_data_flags": [],

  // ── Access Protection (Cloudflare) ───────────────────────
  "cloudflare": {
    "account_id": "",          // Cloudflare account ID
    "zone_id": "",             // Zone ID for the household domain
    "household_domain": "",    // e.g. "example.com" — read at runtime only
    "access_policy_id": "",    // Existing Access policy to apply to new apps
    "api_token": ""            // Cloudflare API token — use env var in CI
  },

  // ── Household Structure ───────────────────────────────────
  "household": {
    "household_id": "",        // UUID of the household in Supabase
    "member_ids": []           // UUIDs of household members
  },

  // ── Supabase ──────────────────────────────────────────────
  // ── Vercel ────────────────────────────────────────────────
  "vercel": {
    "api_token": "",           // Vercel API token — use env var in CI
    "team_id": "",             // Vercel team ID (optional, for team accounts)
    "region": ""               // Serverless function region (e.g. "lhr1") — read at runtime only
  },

  // ── Supabase ──────────────────────────────────────────────
  "supabase": {
    "project_ref": "",         // Supabase project reference
    "project_url": ""          // Supabase project URL — read at runtime only
  }
}
```

## Reading the Config in Shell Scripts

```bash
CONFIG_FILE="$HOME/.bootstrap-config.json"

# Guard: ensure file exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: ~/.bootstrap-config.json not found."
  exit 1
fi

# Guard: ensure jq is available
if ! command -v jq &> /dev/null; then
  echo "ERROR: jq is required. Install with: brew install jq"
  exit 1
fi

# Read a top-level string field
HOUSEHOLD_DOMAIN=$(jq -r '.cloudflare.household_domain' "$CONFIG_FILE")

# Read an array as newline-separated values
PERSONAL_FLAGS=$(jq -r '.personal_data_flags[]' "$CONFIG_FILE" 2>/dev/null)

# Read an array into a bash array
mapfile -t PERSONAL_FLAGS_ARR < <(jq -r '.personal_data_flags[]' "$CONFIG_FILE")

# Check if a field is present and non-empty
if [ "$(jq -r '.cloudflare.household_domain' "$CONFIG_FILE")" = "null" ]; then
  echo "ERROR: cloudflare.household_domain not set in config."
  exit 1
fi
```

## Reading the Config in TypeScript

```typescript
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

interface BootstrapConfig {
  personal_data_flags: string[]
  partner_personal_data_flags: string[]
  cloudflare: {
    account_id: string
    zone_id: string
    household_domain: string
    access_policy_id: string
    api_token: string
  }
  household: {
    household_id: string
    member_ids: string[]
  }
  vercel: {
    api_token: string
    team_id: string
    region: string
  }
  supabase: {
    project_ref: string
    project_url: string
  }
}

function loadBootstrapConfig(): BootstrapConfig {
  const configPath = join(homedir(), '.bootstrap-config.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as BootstrapConfig
  } catch {
    throw new Error(`Cannot read ~/.bootstrap-config.json. Ensure it exists and is valid JSON.`)
  }
}

export const bootstrapConfig = loadBootstrapConfig()
```

## Security Rules

1. **Never commit** `~/.bootstrap-config.json` or any copy of it to any repository
2. **Never log** the contents of `personal_data_flags` or `partner_personal_data_flags`
3. **Never include** bootstrap config values in error messages, stack traces, or CI logs
4. **Add to .gitignore** in every Household App Infrastructure app repo: `.bootstrap-config.json`
5. **Rotate** the config if any value is accidentally committed — treat it like a leaked secret
6. The config file should have restrictive permissions: `chmod 600 ~/.bootstrap-config.json`
