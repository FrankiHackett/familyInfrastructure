# Pass 2 — LLM Review Prompt Template

This is the exact prompt sent to Claude during Pass 2. It is designed to elicit structured JSON output and avoid echoing personal values back in the response.

## Prompt Template

```
You are a security auditor reviewing source code for hardcoded personal data before a git push.

Your task: identify any string values in the code below that appear to be real personal, household, or identifying data.

CRITICAL RULES:
1. Do NOT quote or repeat any suspicious value in your response. Refer to findings by file path and line number only.
2. Return ONLY valid JSON — no explanation text before or after the JSON block.
3. If you find no issues, return: {"findings": []}

CATEGORIES to look for:
- person_name: a real person's full name, first name, or last name used as a data value
- email_address: any email address that appears operational (not @example.com, @test.com)
- phone_number: any phone number format
- physical_address: street address, postcode, or city used in personal context
- date_of_birth: birth dates
- health_data: medical conditions, medications, biometric data
- financial_data: bank account numbers, sort codes, credit card patterns
- national_id: passport numbers, national insurance, SSN, driving licence
- household_identifier: values that appear to identify a specific household
- relationship_identifier: partner name, family member name used as a value
- location_data: specific home or work location
- username_handle: social media handles or usernames in personal context

CONFIDENCE levels:
- HIGH: almost certainly real personal data, appears operational
- MEDIUM: could be personal data, ambiguous
- LOW: unlikely personal data, surface resemblance only

Do NOT flag:
- Code identifiers (variable names, function names, class names)
- Example/placeholder values containing: example, test, placeholder, todo, foo, bar, mock, dummy, fake
- Standard library names, framework names, package names
- SQL column names or TypeScript type names
- Comments

Return this exact JSON structure:
{
  "findings": [
    {
      "file": "relative/path/to/file.ts",
      "line": 42,
      "category": "person_name",
      "confidence": "HIGH",
      "note": "brief description of why this is suspicious — do NOT include the value itself"
    }
  ]
}

CODE TO REVIEW:
---
{CODE_CONTENT}
---
```

## Building the Code Content Block

Before sending, pre-process the code to reduce noise:

1. Strip comments (they rarely contain committed personal data)
2. Strip import statements (just module paths)
3. Keep: string literals, template literals, object values, function call arguments
4. Annotate each line with its file path and line number in the format `{file}:{line}: {code}`

```bash
# Build the review payload
REVIEW_PAYLOAD=$(mktemp /tmp/household-app-infrastructure-pass2-XXXXXX.txt)

for FILE in $HIGH_RISK_FILES; do
  # Add file header
  echo "=== $FILE ===" >> "$REVIEW_PAYLOAD"

  # Extract lines with string content, annotated
  grep -n '["'\''\`]' "$FILE" | \
    grep -v '^\s*//' | \
    grep -v '^import ' | \
    sed "s|^|$FILE:|" >> "$REVIEW_PAYLOAD"
done
```

## Sending to Claude

Use the Claude CLI or API. Prefer the CLI for pre-push hooks:

```bash
PROMPT_TEMPLATE=$(cat "$(dirname "$0")/references/llm-review-prompt.md" | \
  sed -n '/^```$/,/^```$/p' | grep -v '^```' | head -1)

# Inject code content into prompt
FULL_PROMPT=$(echo "$PROMPT_TEMPLATE" | sed "s|{CODE_CONTENT}|$(cat $REVIEW_PAYLOAD)|")

# Send to Claude and capture JSON response
RESPONSE=$(echo "$FULL_PROMPT" | claude -p - --output-format json 2>/dev/null)

# Parse findings
HIGH_COUNT=$(echo "$RESPONSE" | jq '[.findings[] | select(.confidence == "HIGH")] | length')
MEDIUM_COUNT=$(echo "$RESPONSE" | jq '[.findings[] | select(.confidence == "MEDIUM")] | length')
LOW_COUNT=$(echo "$RESPONSE" | jq '[.findings[] | select(.confidence == "LOW")] | length')
```

## Handling API Failure

If the Claude API call fails (network error, rate limit, missing credentials):

```bash
if [ $? -ne 0 ] || [ -z "$RESPONSE" ]; then
  echo "WARNING [Pass 2]: Claude API unavailable. Pass 2 skipped."
  echo "  Reason: $CLAUDE_ERROR"
  echo "  Manual review recommended before pushing."
  # Do not hard-block on API failure — continue to Pass 3
fi
```

Never hard-block purely because the API was unavailable. Log the skip prominently so the developer is aware.

## Response Validation

Before processing the response, validate it is valid JSON with the expected structure:

```bash
# Validate JSON
if ! echo "$RESPONSE" | jq -e '.findings | arrays' > /dev/null 2>&1; then
  echo "WARNING [Pass 2]: Claude returned unexpected response format. Skipping."
  # Log response to temp file for debugging — ensure it doesn't contain personal values
  echo "$RESPONSE" > /tmp/household-app-infrastructure-pass2-debug-$$.txt
  echo "  Debug output written to /tmp/household-app-infrastructure-pass2-debug-$$.txt"
fi
```

## Token Budget

To avoid high API costs on large codebases, cap the review payload:

```bash
MAX_REVIEW_LINES=500

REVIEW_LINES=$(wc -l < "$REVIEW_PAYLOAD")
if [ "$REVIEW_LINES" -gt "$MAX_REVIEW_LINES" ]; then
  echo "INFO [Pass 2]: Review payload truncated to $MAX_REVIEW_LINES lines (was $REVIEW_LINES)."
  echo "  Consider running targeted scan with: --pass2-files <file1> <file2>"
  head -n "$MAX_REVIEW_LINES" "$REVIEW_PAYLOAD" > "${REVIEW_PAYLOAD}.truncated"
  REVIEW_PAYLOAD="${REVIEW_PAYLOAD}.truncated"
fi
```
