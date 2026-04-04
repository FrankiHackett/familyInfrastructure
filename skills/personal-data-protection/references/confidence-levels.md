# Pass 2 Confidence Levels — Decision Table

Claude's LLM judgement pass returns findings with a confidence level. This table defines exactly what action to take at each level.

---

## Confidence Level Definitions

### HIGH Confidence

**Definition:** The value is almost certainly real personal data — a specific person's name used in context, a real email address format, a real phone number, a physical address, a date of birth, a government ID number, or any value that is clearly identifying and appears to be operational (not example/test data).

**Criteria for HIGH:**
- The value appears in an LLM prompt string as if describing a real person
- The value matches patterns for email (`\w+@\w+\.\w+`), phone, or postal address
- The value is a proper noun used as a name in a data context (not a code identifier)
- The value appears multiple times across the codebase (consistent with real usage)
- The value is adjacent to fields like `name:`, `email:`, `address:`, `user:` in objects

**Action: HARD BLOCK**

```
BLOCKED [Pass 2 - HIGH]: Possible personal data detected
File:     {filepath}:{line_number}
Category: {category — e.g. "person name", "email address", "phone number"}
Context:  {surrounding code snippet, value REDACTED}

This push has been blocked. You must:
1. Replace the hardcoded value with an environment variable
2. Or confirm it is synthetic/test data and re-run with --pass2-override

Do NOT push until resolved.
```

Do not continue to Pass 3 if any HIGH finding exists.

---

### MEDIUM Confidence

**Definition:** The value could be personal data but is ambiguous. Examples: a common first name used as a variable value (could be a placeholder), a number that looks like a phone number but might be a config value, a string that resembles an address but could be an example.

**Criteria for MEDIUM:**
- Common first name used as a string value (not a code identifier like `userName`)
- Number pattern that could be a phone or ID but lacks enough digits for certainty
- Email-like string that uses obvious example domains (`@example.com`, `@test.com`) — lower risk
- A string that appears in an LLM prompt context but could be intentionally fictional

**Action: INTERACTIVE REVIEW PROMPT**

```
REVIEW REQUIRED [Pass 2 - MEDIUM]: Possible personal data
File:     {filepath}:{line_number}
Category: {category}
Context:  {surrounding code snippet, value REDACTED}

Is this real personal data that should not be committed? [y/N]:
```

**If user answers `y`:** Treat as HIGH — hard block, print full remediation instructions.
**If user answers `n`:** Log the override and continue.
**If running non-interactively (CI):** Treat MEDIUM as HIGH — hard block. CI cannot prompt.

To detect CI context:
```bash
if [ -n "$CI" ] || [ -n "$GITHUB_ACTIONS" ]; then
  # Non-interactive: treat MEDIUM as HIGH
  MEDIUM_AS_HIGH=true
fi
```

---

### LOW Confidence

**Definition:** The value is unlikely to be real personal data but has surface-level characteristics worth noting. Examples: a common word that happens to be a name (`"Jordan"` as a brand reference), a number that's too short or too long to be a phone number, a placeholder clearly marked as such (`TODO`, `PLACEHOLDER`, `example`).

**Criteria for LOW:**
- Value contains obvious placeholder markers: `example`, `test`, `placeholder`, `todo`, `fixme`, `xxx`, `foo`, `bar`
- Value is a common English word that happens to resemble a name
- Numeric value that doesn't match any personal ID format
- Value appears in a comment, not executable code

**Action: LOG ONLY**

```
INFO [Pass 2 - LOW]: Low-confidence possible personal data — logged only
File:     {filepath}:{line_number}
Category: {category}
```

No blocking. No prompt. Record in the run log for audit trail purposes.

---

## Summary Table

| Confidence | Criteria | Interactive Action | CI Action |
|---|---|---|---|
| HIGH | Clearly personal, operational data | Hard block | Hard block |
| MEDIUM | Ambiguous, could be personal | Prompt user | Hard block |
| LOW | Unlikely personal, surface resemblance | Log only | Log only |

---

## Override Mechanism

For cases where a HIGH or MEDIUM finding is a known false positive (e.g., a fixture file used for integration tests), an override file can be maintained:

**`.personal-data-allowlist`** (add to `.gitignore`):
```
# Lines starting with # are comments
# Format: filepath:line_number:reason
tests/fixtures/mock-user.ts:14:synthetic test data — not a real person
```

The scan should check this file and skip allowlisted locations. The allowlist file itself must never be committed.

---

## Categories Returned by Claude

Claude should classify each finding into one of these categories:

| Category | Examples |
|---|---|
| `person_name` | Full name, first name used in personal context |
| `email_address` | Any email-format string |
| `phone_number` | Any phone-format string |
| `physical_address` | Street address, postcode, city in personal context |
| `date_of_birth` | Any birth date |
| `health_data` | Medical conditions, medications, biometric values |
| `financial_data` | Account numbers, sort codes, credit card patterns |
| `national_id` | Passport, NI number, SSN, driving licence |
| `household_identifier` | Values that identify the specific household |
| `relationship_identifier` | Partner names, family member names |
| `location_data` | Specific home/work location beyond general area |
| `username_handle` | Social media handles, usernames in personal context |
