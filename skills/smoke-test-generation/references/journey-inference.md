# Journey Inference from App Code

How to read existing app code and identify the critical user journeys that need smoke test coverage.

## Inference Priority Order

Always cover these categories first, in order:

1. **Authentication** — sign in, sign out, session persistence, protected route redirects
2. **Core data creation** — the primary `INSERT` operation the app exists to do
3. **Core data retrieval** — the primary `SELECT` and display flow
4. **AI-powered flows** — user-triggered LLM calls (highest risk for regressions and cost)
5. **Email/notification flows** — Resend sends, confirmation emails
6. **Error states** — 401, 404, 500 handling for the above

Stop at 8–10 journeys total. Smoke tests should be fast and targeted, not exhaustive.

---

## Signal: Route Handlers → API Journeys

Each `app/api/*/route.ts` or `pages/api/*.ts` file represents a server-side journey.

Scan for exported HTTP method handlers:
```
Grep: export async function (GET|POST|PUT|PATCH|DELETE)
```

For each handler found:
- **GET** → data retrieval journey
- **POST** → data creation journey
- **PUT/PATCH** → data update journey
- **DELETE** → data deletion journey

Read the handler body to understand:
- What data it expects in the request
- What Supabase tables it touches
- What external services it calls
- What it returns on success/failure

---

## Signal: Page Components → UI Journeys

Scan page files for forms and data fetching:

```
Grep: <form|onSubmit|handleSubmit   → form submission journey
Grep: useEffect.*fetch|useSWR|useQuery  → data loading journey
Grep: router\.push|redirect\(      → navigation flow
```

For each form found, the journey is: fill form → submit → see result.

---

## Signal: Auth References → Auth Journeys

```
Grep: supabase\.auth\.(signIn|signUp|signOut|getUser|getSession)
Grep: createServerClient|createBrowserClient
Grep: middleware\.ts (auth middleware)
```

If `middleware.ts` exists, read it — it defines which routes are protected, which is essential for redirect testing.

---

## Signal: LLM API Calls → AI Journeys

```
Grep: anthropic\.messages\.create
Grep: openai\.chat\.completions\.create
Grep: streamText|generateText  (Vercel AI SDK)
```

For each LLM call found:
- Identify the trigger: which user action leads to this call?
- Identify the input: what user data is sent to the LLM?
- Identify the output: what does the app do with the response?

The journey: trigger action → LLM call (mocked) → response displayed.

---

## Signal: Supabase Mutations → Data Journeys

```
Grep: \.insert\(
Grep: \.update\(
Grep: \.delete\(
Grep: \.upsert\(
```

For each mutation, trace back to the user action that triggers it (form submit, button click, API call from a page). That trace is the journey.

---

## Signal: Email Sends → Notification Journeys

```
Grep: resend\.emails\.send
Grep: from 'resend'
```

Identify what triggers the email send. The journey ends with verifying the send was called (mocked) with the correct parameters.

---

## Journey Documentation Template

For each inferred journey, document it before writing the test:

```
Journey: {name}
Trigger: {what the user does — e.g., "submits login form"}
Steps:
  1. Navigate to {url}
  2. {action}
  3. Expect {outcome}
External calls: {list of APIs called — these need mocks}
Test type: {Vitest integration / Playwright e2e}
Priority: {high / medium / low}
```

---

## Example: Triathlon App Journeys

Given an app that records triathlon workouts:

| Journey | Type | Why High Priority |
|---|---|---|
| Sign in with email/password | Playwright e2e | Gate to all other functionality |
| Log a new workout session | Playwright e2e | Core app function |
| View session history | Vitest integration | Most frequent operation |
| Generate AI coaching feedback | Vitest integration | Highest cost risk if mock breaks |
| Sign out | Playwright e2e | Session management |

---

## What NOT to Test in Smoke Tests

- Unit testing individual utility functions (that's a full test suite job)
- Testing Supabase RLS policies (test in Supabase directly)
- Testing every edge case of a form (smoke tests verify the happy path works)
- Testing UI visual layout (use visual regression tools for that)
- Testing with real paid API calls (always mock)

Smoke tests answer: **"Does the app start, can a user do the thing, does it not explode?"**
