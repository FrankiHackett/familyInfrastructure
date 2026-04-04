---
name: personal-data-protection
description: This skill should be used when the user asks to "check for personal data", "run a pre-push check", "scan for hardcoded values", "protect personal data before pushing", "audit for sensitive data", or before any git push in a Household App Infrastructure app. Runs a three-pass check to ensure no personal, household, or identifying data is hardcoded in committed code.
version: 1.0.0
allowed-tools: [Read, Glob, Grep, Bash, Write]
---

# Personal Data Protection

Three-pass pre-push check that ensures no personal, household, or identifying data is hardcoded in any Household App Infrastructure app. All data flags are read from `~/.bootstrap-config.json` at runtime — this skill file itself contains zero personal values.

## When This Skill Applies

Activate when the user:
- Is about to `git push` any Household App Infrastructure app code
- Asks to scan for hardcoded personal data
- Asks to run a pre-push check
- Wants to audit committed code for sensitive values

---

## Critical Rule

**This skill must never contain, log, print, or embed any personal values.** All scan targets are loaded from `~/.bootstrap-config.json` at runtime and treated as opaque secrets. Findings are reported as redacted references (e.g., `[FLAG:personal_data_flags[0]]`) — never echoing the actual value back.

---

## Setup: Reading the Config

Before running any pass, load flags from the config file:

```bash
CONFIG_FILE="$HOME/.bootstrap-config.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: ~/.bootstrap-config.json not found. Cannot run personal data protection check."
  exit 1
fi
```

Read flags using `jq`. See `references/bootstrap-config-schema.md` for the expected config shape.

```bash
# Read personal data flags as a newline-separated list
PERSONAL_FLAGS=$(jq -r '.personal_data_flags[]' "$CONFIG_FILE" 2>/dev/null)
PARTNER_FLAGS=$(jq -r '.partner_personal_data_flags[]' "$CONFIG_FILE" 2>/dev/null)

if [ -z "$PERSONAL_FLAGS" ] && [ -z "$PARTNER_FLAGS" ]; then
  echo "WARNING: No personal data flags found in config. Skipping Pass 1."
fi
```

**Never log these values.** Only log that they were loaded and how many were found:

```bash
PERSONAL_COUNT=$(echo "$PERSONAL_FLAGS" | grep -c . 2>/dev/null || echo 0)
PARTNER_COUNT=$(echo "$PARTNER_FLAGS" | grep -c . 2>/dev/null || echo 0)
echo "Loaded $PERSONAL_COUNT personal flags, $PARTNER_COUNT partner flags from config."
```

---

## Pass 1 — Fast String Scan

**Goal:** Detect any literal occurrence of a known personal or partner value in staged/committed files.

**Speed target:** Sub-second on typical app codebases.

### What to Scan

Scan the git staging area (files that will be committed), not the full working tree:

```bash
# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
  echo "Pass 1: No staged files. Skipping."
  # Fall through to pass 2 if checking all tracked files
fi
```

If running as a full repo audit (not pre-commit), scan all tracked files:

```bash
ALL_FILES=$(git ls-files)
```

### Exclusions

Always exclude:
- `.git/` directory
- `node_modules/`
- `*.lock` files (package-lock.json, yarn.lock, pnpm-lock.yaml)
- `dist/`, `build/`, `.next/` (generated output)
- Binary files (images, fonts, compiled assets)
- This config file itself: `~/.bootstrap-config.json` is never in the repo

### Scan Logic

```bash
PASS1_FINDINGS=0
PASS1_HARD_BLOCKS=0

for FLAG in $PERSONAL_FLAGS $PARTNER_FLAGS; do
  # Determine which array this flag came from (for reporting)
  FLAG_SOURCE="personal_data_flags"
  echo "$PARTNER_FLAGS" | grep -qxF "$FLAG" && FLAG_SOURCE="partner_personal_data_flags"

  MATCHES=$(echo "$FILES_TO_SCAN" | xargs grep -lF "$FLAG" 2>/dev/null)

  if [ -n "$MATCHES" ]; then
    PASS1_FINDINGS=$((PASS1_FINDINGS + 1))
    PASS1_HARD_BLOCKS=$((PASS1_HARD_BLOCKS + 1))

    # Report: redact the actual value, show source array and index
    FLAG_INDEX=$(echo "$PERSONAL_FLAGS $PARTNER_FLAGS" | tr ' ' '\n' | grep -n "^${FLAG}$" | cut -d: -f1)
    echo "HARD BLOCK [Pass 1]: Found [FLAG:${FLAG_SOURCE}[redacted]] in:"
    echo "$MATCHES" | while read -r file; do
      LINE=$(grep -nF "$FLAG" "$file" | head -3 | cut -d: -f1 | tr '\n' ',')
      echo "  $file (lines: $LINE)"
    done
  fi
done

if [ "$PASS1_HARD_BLOCKS" -gt 0 ]; then
  echo ""
  echo "BLOCKED: Pass 1 found $PASS1_HARD_BLOCKS hardcoded personal value(s)."
  echo "Replace each flagged value with an environment variable reference."
  echo "See references/remediation-guide.md for fix patterns."
  exit 1
fi

echo "Pass 1: PASSED — no known personal values found in $PASS1_FINDINGS checks."
```

**Outcome:** Any match is an immediate hard block. Do not proceed to Pass 2.

---

## Pass 2 — LLM Judgement

**Goal:** Identify hardcoded values that *look like* real personal, household, or identifying data even if they don't match a known flag. Specialises in catching values embedded in prompt strings and template literals passed to LLM APIs.

**This pass requires Claude API access.** If unavailable, warn and skip (do not hard-block on API failure alone).

### What to Send to Claude

Collect the high-risk code regions first — don't send entire files:

1. All template literals (backtick strings) — especially multi-line ones
2. All string arguments to LLM API calls (`anthropic.messages.create`, `openai.chat.completions.create`)
3. All prompt-building functions and constants
4. All strings longer than 20 characters that aren't obviously code (URLs, SQL, regex)

```bash
# Extract template literals and LLM call arguments for review
# Write to a temp file — never to a committed path
TEMP_REVIEW=$(mktemp /tmp/household-app-infrastructure-review-XXXXXX.txt)

grep -rn --include="*.ts" --include="*.tsx" --include="*.js" \
  -E '`[^`]{20,}`|anthropic\.|openai\.' \
  $FILES_TO_SCAN >> "$TEMP_REVIEW" 2>/dev/null
```

### The Claude Review Prompt

See `references/llm-review-prompt.md` for the full prompt template. Key instructions to Claude:

- Identify any string values that appear to be real person names, addresses, phone numbers, email addresses, dates of birth, health data, financial data, relationship identifiers, or household-specific identifiers
- Classify each finding as `HIGH`, `MEDIUM`, or `LOW` confidence
- Return structured JSON — never echo the flagged value back, just its location and classification
- Treat any value that appears in an LLM prompt string with elevated scrutiny

### Handling Results by Confidence Level

See `references/confidence-levels.md` for full decision table.

```
HIGH confidence   → Hard block. Abort push. Print location, prompt for manual review.
MEDIUM confidence → Soft block. Print location, ask user to confirm before continuing.
LOW confidence    → Log only. Print location as informational. Do not block.
```

#### High Confidence — Hard Block

```
BLOCKED [Pass 2 - HIGH]: Possible personal data found at {file}:{line}
  Category: [person name / address / health data / etc]
  Action required: Replace with environment variable or confirm this is not real data.

To override: re-run with --skip-pass2 (not recommended)
```

#### Medium Confidence — Review Prompt

```
REVIEW REQUIRED [Pass 2 - MEDIUM]: Possible personal data at {file}:{line}
  Category: [category]

Is this real personal data? [y/N]:
```

If user answers `y`: hard block.
If user answers `n`: log and continue.

#### Low Confidence — Log Only

```
INFO [Pass 2 - LOW]: Possible personal data at {file}:{line} — logged only
```

**Outcome:** Any HIGH finding is a hard block. MEDIUM requires user confirmation. LOW is informational.

---

## Pass 3 — Template Literal Deep Scan

**Goal:** Confirm that all values passed to LLM APIs inside template literals are read from environment variables, not hardcoded.

**This is the most targeted pass** — it specifically looks at the code path: value → template literal → LLM API call.

### Detection Pattern

Find all template literal strings that are passed (directly or via a variable) to an LLM API call:

```bash
# Files that contain LLM API calls
LLM_FILES=$(grep -rl --include="*.ts" --include="*.tsx" --include="*.js" \
  -E 'anthropic\.|openai\.|\.messages\.create|\.chat\.completions' \
  $FILES_TO_SCAN 2>/dev/null)
```

For each such file, extract the full template literal content (including multi-line spans) and check whether any interpolated values (`${...}`) come from:

**Safe sources (allow):**
- `process.env.VARIABLE_NAME`
- `env.VARIABLE_NAME` (where env is loaded via dotenv or Next.js config)
- Function parameters (data passed in, not hardcoded)
- Database query results
- Other variables that can be traced back to env or function args

**Unsafe sources (flag):**
- String literals: `"John"`, `'Smith'`
- Object literals with hardcoded string values: `const user = { name: "John" }`
- Module-level constants with string values that look personal

### Scan Logic

```bash
PASS3_FINDINGS=0

for FILE in $LLM_FILES; do
  # Use AST-aware analysis where possible; fall back to regex heuristics
  # Look for: template literals containing ${varName} where varName is NOT from env

  # Heuristic: flag any template literal in an LLM call that contains:
  # - Capitalised words that look like names
  # - @-sign patterns (email)
  # - Digit patterns that look like phone/ID numbers
  # - Words like "my", "our", "home", "family" followed by specific values

  SUSPICIOUS=$(grep -n '`' "$FILE" | grep -E '\$\{[^e][^n][^v]' | head -20)

  if [ -n "$SUSPICIOUS" ]; then
    PASS3_FINDINGS=$((PASS3_FINDINGS + 1))
    echo "REVIEW [Pass 3]: Template literal in LLM call at $FILE may contain non-env values:"
    echo "$SUSPICIOUS"
    echo "  Verify: all interpolated values must come from process.env or function parameters"
  fi
done

if [ "$PASS3_FINDINGS" -eq 0 ]; then
  echo "Pass 3: PASSED — all LLM template literals use safe value sources."
else
  echo "Pass 3: $PASS3_FINDINGS file(s) require manual review."
  echo "Push is BLOCKED until all LLM template literals are verified."
  exit 1
fi
```

---

## Full Run Summary

After all three passes:

```
============================================================
Personal Data Protection — Summary
============================================================
Pass 1 (String Scan):      PASSED / BLOCKED (n findings)
Pass 2 (LLM Judgement):    PASSED / BLOCKED (n high, n medium, n low)
Pass 3 (Template Literals): PASSED / BLOCKED (n findings)
------------------------------------------------------------
Overall:                    CLEAR TO PUSH / BLOCKED
============================================================
```

---

## Installing as a Pre-Push Hook

To run automatically before every push, generate a git hook:

```bash
#!/bin/sh
# .git/hooks/pre-push
# Generated by personal-data-protection skill

echo "Running Household App Infrastructure personal data protection check..."
claude -p "Run the personal-data-protection skill on staged files" --allowedTools Bash,Read,Grep
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "Push blocked by personal data protection check."
  exit 1
fi
```

Make it executable:
```bash
chmod +x .git/hooks/pre-push
```

---

## References

- `references/bootstrap-config-schema.md` — Expected shape of `~/.bootstrap-config.json`
- `references/confidence-levels.md` — Full decision table for Pass 2 confidence levels
- `references/llm-review-prompt.md` — The exact prompt template sent to Claude in Pass 2
- `references/remediation-guide.md` — How to fix each category of finding
