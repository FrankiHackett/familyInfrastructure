# Remediation Guide

How to fix each category of personal data finding. Apply the appropriate pattern based on the finding category.

---

## General Rule

Every personal or household value in application code must come from one of:
1. `process.env.VARIABLE_NAME` — environment variable
2. A database query result — fetched at runtime, not embedded
3. A function parameter — passed in from a calling context that reads from env/db

Never from a string literal, template literal constant, or module-level constant with a hardcoded value.

---

## Fix Pattern 1: Simple String Replacement

**Finding:** A string literal with a personal value assigned to a variable.

**Before:**
```typescript
const ownerName = "Jane Smith"  // BLOCKED
```

**After:**
```typescript
const ownerName = process.env.OWNER_NAME
if (!ownerName) throw new Error('OWNER_NAME environment variable is required')
```

Add the variable to `.env.local` and `.env.local.template`:
```bash
# .env.local (never committed)
OWNER_NAME=your-value-here

# .env.local.template (committed — no values)
OWNER_NAME=
```

---

## Fix Pattern 2: LLM Prompt with Embedded Personal Value

**Finding:** A template literal passed to an LLM API that contains a hardcoded personal value.

**Before:**
```typescript
const prompt = `You are helping Jane, who lives in London.`  // BLOCKED
```

**After:**
```typescript
const userName = process.env.USER_DISPLAY_NAME
const userCity = process.env.USER_CITY

if (!userName || !userCity) {
  throw new Error('USER_DISPLAY_NAME and USER_CITY env vars required')
}

const prompt = `You are helping ${userName}, who lives in ${userCity}.`
```

---

## Fix Pattern 3: Config Object with Personal Values

**Finding:** An object literal with personal values as property values.

**Before:**
```typescript
const config = {
  ownerEmail: "jane@example.com",   // BLOCKED
  partnerEmail: "john@example.com", // BLOCKED
}
```

**After:**
```typescript
const config = {
  ownerEmail: process.env.OWNER_EMAIL,
  partnerEmail: process.env.PARTNER_EMAIL,
}

// Validate at startup
const required = ['OWNER_EMAIL', 'PARTNER_EMAIL']
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`)
}
```

---

## Fix Pattern 4: Personal Value in Test Fixture

**Finding:** A test fixture or mock file with real personal data.

**Rule:** Test fixtures must use obviously synthetic data. Use placeholder values that cannot be mistaken for real people.

**Before:**
```typescript
const mockUser = {
  name: "Jane Smith",   // BLOCKED — looks like a real person
  email: "jane@gmail.com"
}
```

**After:**
```typescript
const mockUser = {
  name: "Test User",
  email: "testuser@example.com"  // @example.com domain signals synthetic data
}
```

Or use a test data factory:
```typescript
const mockUser = createMockUser({
  name: "Test User",
  email: "test@example.com"
})
```

If the test genuinely needs a personal value (e.g., testing name parsing), read it from env:
```typescript
const mockUser = {
  name: process.env.TEST_USER_NAME ?? "Test User",
  email: process.env.TEST_USER_EMAIL ?? "test@example.com"
}
```

---

## Fix Pattern 5: Personal Value in Prompt System Message

**Finding:** A hardcoded system message passed to an LLM with personal context.

**Before:**
```typescript
const systemMessage = {
  role: "system",
  content: "You are a coach for Jane. Her training partner is John. They live in Edinburgh."
}
```

**After:**
```typescript
function buildSystemMessage(): string {
  const primaryName = process.env.PRIMARY_USER_NAME
  const partnerName = process.env.PARTNER_USER_NAME
  const userCity = process.env.USER_CITY

  if (!primaryName || !partnerName || !userCity) {
    throw new Error('User context env vars not configured')
  }

  return `You are a coach for ${primaryName}. Their training partner is ${partnerName}. They live in ${userCity}.`
}
```

---

## Fix Pattern 6: Hardcoded Household ID or Member ID

**Finding:** A UUID that corresponds to a real household or user ID.

**Before:**
```typescript
const HOUSEHOLD_ID = "b3f4a1d2-..."  // BLOCKED
```

**After:**
```typescript
const HOUSEHOLD_ID = process.env.HOUSEHOLD_ID
// Or read from bootstrap config at startup:
const { household: { household_id } } = loadBootstrapConfig()
```

---

## Environment Variable Naming Conventions

Use these prefixes for consistency:

| Prefix | Meaning |
|---|---|
| `OWNER_` | Belongs to the primary user |
| `PARTNER_` | Belongs to the partner user |
| `HOUSEHOLD_` | Belongs to the household entity |
| `USER_` | Generic authenticated user |
| `TEST_` | Used only in test environments |

---

## After Fixing

1. Add new env vars to `.env.local` (never committed)
2. Add the variable names (no values) to `.env.local.template` (committed)
3. Add to the startup validation function (see env-var-audit skill)
4. Re-run the personal-data-protection check to confirm the finding is resolved
5. If you previously committed the personal value: rotate it (treat as a leaked secret), and remove it from git history if the repo is private but shared
