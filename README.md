# Household App Bootstrap Agent

An automated zero-to-deployed orchestration tool that takes a new web application from an empty directory to a fully deployed, authenticated household app. It scaffolds the project, sets up a database, creates a GitHub repo, deploys to Vercel, and protects it behind Cloudflare Access — all from a single command.

**Stack**: Vite + React + TypeScript · Supabase · Vercel · Cloudflare · GitHub

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Service Account Setup](#2-service-account-setup)
3. [Config File Setup](#3-config-file-setup)
4. [Running the Bootstrap](#4-running-the-bootstrap)
5. [What Happens — Phase by Phase](#5-what-happens--phase-by-phase)
6. [After Bootstrap](#6-after-bootstrap)
7. [Other Commands](#7-other-commands)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

### System requirements

- **Node.js** ≥ 18.0.0 — check with `node --version`
- **Git** — check with `git --version`

### CLI tools

Install the Supabase CLI if your app will use a database:

```bash
npm install -g @supabase/cli
# or on macOS
brew install supabase/tap/supabase
```

Install Gitleaks for secret scanning (strongly recommended):

```bash
# macOS
brew install gitleaks

# Linux — download from https://github.com/gitleaks/gitleaks/releases
```

### Clone this repo

```bash
git clone git@github.com:FrankiHackett/familyInfrastructure.git
cd familyInfrastructure
npm install
```

---

## 2. Service Account Setup

You will need accounts and credentials from several services before running the bootstrap. Set each one up below, then put all the values into your config file (see [Section 3](#3-config-file-setup)).

### GitHub

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Set an expiry (or no expiry for a household tool)
4. Select scopes: `repo` (full control of private repositories), `user:email`
5. Save the token — you'll only see it once

### Cloudflare

You need a domain managed by Cloudflare. The bootstrap will create a subdomain per app (e.g., `my-app.yourdomain.com`).

**Account ID and Zone ID:**
1. Log into the Cloudflare dashboard
2. Click your domain
3. On the Overview page, scroll down the right sidebar to find your **Zone ID**
4. Your **Account ID** is visible in the URL when you're in the Cloudflare dashboard: `dash.cloudflare.com/<account-id>/...`

**API Token:**
1. Go to **My Profile → API Tokens → Create Token**
2. Use the **Create Custom Token** option
3. Set these permissions:
   - Zone → DNS → Edit
   - Zone → Zone → Read
   - Account → Access: Apps and Policies → Edit
4. Under **Zone Resources**, select your domain
5. Save the token

**Access Policy:**

The bootstrap attaches a pre-existing Cloudflare Access policy to each app. You need to create this policy once and reuse it.

1. Go to **Cloudflare Zero Trust → Access → Policies**
2. Click **Create a policy**
3. Name it something like `Household Members`
4. Under **Rules**, add the emails of everyone in your household (Include → Emails)
5. Save it and copy the Policy UUID from the policy list

### Vercel

1. Go to **Vercel → Settings → Tokens**
2. Click **Create Token**
3. Give it a name and set scope to your account (or team if applicable)
4. Save the token

If you're on a Vercel team account, also grab your **Team ID** from **Team Settings → General**.

### Supabase

You need one shared Supabase project. Each bootstrapped app gets its own schema namespace within it.

1. Create a project at [supabase.com](https://supabase.com)
2. Once created, go to **Project Settings → API**:
   - Copy the **Project URL** (e.g., `https://abcdefgh.supabase.co`)
   - Copy the **anon/public** key
   - Copy the **service_role** key (keep this secret — server-side only)
3. Get your **Project Reference** — it's the unique ID in your project URL: `https://supabase.com/dashboard/project/<project-ref>`
4. Create a Supabase **Access Token** for the CLI:
   - Go to **Account Settings → Access Tokens**
   - Click **Generate new token**

### Anthropic (optional)

Only needed if your app will call the Claude API.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Go to **API Keys → Create Key**
3. Save the key

### Resend (optional)

Only needed if your app will send emails.

1. Go to [resend.com](https://resend.com) and create an account
2. Go to **API Keys → Create API Key**
3. Set up a **Sending Domain** and verify it (DNS records in Cloudflare)
4. Save your API key and note your verified sender address

---

## 3. Config File Setup

All credentials live in a single file in your home directory. This file is never committed to git.

Create it:

```bash
touch ~/.bootstrap-config.json
chmod 600 ~/.bootstrap-config.json
```

Then fill it in:

```json
{
  "personal_data_flags": ["Your Name", "your@email.com", "Your Address"],
  "partner_personal_data_flags": ["Partner Name", "partner@email.com"],

  "github": {
    "token": "ghp_xxxxxxxxxxxxxxxxxxxx",
    "username": "your-github-username",
    "email": "your@email.com"
  },

  "cloudflare": {
    "account_id": "your-cloudflare-account-id",
    "zone_id": "your-zone-id",
    "household_domain": "yourdomain.com",
    "access_policy_id": "uuid-of-your-access-policy",
    "api_token": "your-cloudflare-api-token"
  },

  "vercel": {
    "api_token": "your-vercel-api-token",
    "team_id": "team_xxxx"
  },

  "supabase": {
    "project_ref": "your-project-ref",
    "project_url": "https://your-project-ref.supabase.co",
    "anon_key": "eyJhbGc...",
    "service_role_key": "eyJhbGc...",
    "access_token": "sbp_..."
  },

  "anthropic": {
    "api_key": "sk-ant-..."
  },

  "resend": {
    "api_key": "re_...",
    "from_address": "noreply@yourdomain.com"
  }
}
```

**Notes:**
- `personal_data_flags` and `partner_personal_data_flags` are strings that the security scanner will search for in your app's source code before every commit. Add your real name, email, address, phone number, etc. The scanner will alert you if any of these appear hardcoded in your code.
- `team_id` in Vercel is optional — leave it out if you're using a personal account.
- `anthropic` and `resend` sections are only needed if you plan to use those services in any app.

---

## 4. Running the Bootstrap

From the `familyInfrastructure` directory:

```bash
node bootstrap.js
```

You'll be guided through a series of prompts. Here's what you'll be asked and why:

| Prompt | Example | Notes |
|--------|---------|-------|
| App name | `recipe-tracker` | Lowercase, hyphens only, 2–39 chars. Becomes the repo name, subdomain, and database schema. |
| App directory | `~/apps/recipe-tracker` | Where to create the project on your machine. |
| Existing source code | *(optional path)* | If you've already written code, point to the directory and it will be copied in. |
| Owner | `primary` or `partner` | Affects which Row-Level Security defaults are generated. |
| Services | `supabase`, `anthropic`, `resend`, or `none` | Comma-separated list of services to enable. |
| Schema description | `Tracks weekly meal plans and recipes` | Only asked if Supabase is selected. Used to generate a starter migration. |
| Access model | `personal`, `shared`, or `partner` | Controls who can see the data (see below). |

**Access models explained:**

- `personal` — Only you can see your own rows
- `shared` — Everyone in the household can see all rows
- `partner` — Only you and your partner can see rows

Once you confirm the summary, the bootstrap runs all phases automatically. You'll be prompted again at key moments (e.g., before applying a database migration, and when setting up the Cloudflare domain).

**Total runtime**: ~5–10 minutes depending on Vercel build time.

---

## 5. What Happens — Phase by Phase

### Phase 1 — Scaffold

Creates a Vite + React + TypeScript project in your chosen directory. Installs dependencies, generates a starter database migration (if using Supabase), initialises a git repository, and verifies the project builds successfully.

The generated migration creates a schema namespace for your app with:
- A starter table (`[app_name]_entries`) with RLS enabled
- Row-level security policies matching your chosen access model
- An `updated_at` trigger
- Placeholder columns for you to fill in

### Phase 1.5 — Security Scan

Runs four independent checks before any code is committed:

1. **String scan** — Searches all source files for exact matches of your configured personal data flags. Blocks the bootstrap if any are found.
2. **LLM privacy audit** — Sends the source code to Claude for a context-aware review of hardcoded personal information (e.g., real names in seed data). High-confidence findings block; medium-confidence findings prompt for confirmation.
3. **Prompt string scan** — Checks for suspicious string literals inside variables named `prompt`, `context`, or `message` (prevents accidentally hardcoding sensitive data in LLM calls).
4. **Gitleaks** — Scans for leaked secrets and API keys using pattern matching.

### Phase 2 — GitHub

Creates a private repository on GitHub, pushes an initial commit (`chore: bootstrap [app-name]`), and creates a `dev` branch for ongoing development. The GitHub token is used only for the authenticated push and is never stored in git config.

### Phase 3 — Supabase *(if selected)*

Links the project to your Supabase project using the CLI, applies the generated migration, and generates TypeScript database types at `src/types/database.types.ts`. Also writes a typed Supabase client helper at `src/lib/supabase.ts`.

### Phase 4 — Vercel

Creates a Vercel project and injects environment variables:

- **Standard vars** are injected automatically based on the services you selected (Supabase keys, Anthropic API key, Resend credentials, the app's public URL).
- **App-specific vars** are detected by scanning your source code for `import.meta.env.*` and `process.env.*` references. Any variables not covered by the standard set will be prompted for interactively.

> **Tip:** If you know your app needs custom environment variables, you can pre-add them to `~/.bootstrap-config.json` under `app_env_vars.[app-name]` before running the bootstrap to avoid being prompted interactively.

Adds a custom domain (e.g., `recipe-tracker.yourdomain.com`) to the Vercel project.

### Phase 4.5 — Cloudflare Access

Creates a DNS CNAME record for your app's subdomain pointing to Vercel. Then creates a Cloudflare Access application that enforces authentication for the subdomain, attaching your pre-configured household access policy.

You'll be prompted to confirm in the Vercel dashboard that the custom domain appears and is verifying — once you confirm, Cloudflare proxy is enabled (orange cloud).

### Phase 5 — Test Scaffold

Generates a full testing setup:

- **Vitest** config for unit and integration tests (jsdom environment)
- **Playwright** config for E2E smoke tests
- **MSW (Mock Service Worker)** handlers for mocking external APIs in tests
- Starter test files for both Vitest and Playwright
- A **GitHub Actions CI workflow** (`.github/workflows/ci.yml`) that runs on every push to `main`/`dev` and on PRs to `main`

Installs Playwright's Chromium browser automatically.

### Phase 6 — Verify

Polls Vercel every 10 seconds (up to 5 minutes) waiting for the deployment to reach `READY`. Then runs Vitest locally to confirm the tests pass. Prints a full summary of everything that was created.

---

## 6. After Bootstrap

At the end of the bootstrap you'll see a summary like this:

```
App:        recipe-tracker
URL:        https://recipe-tracker.yourdomain.com
Repo:       github.com/YourUsername/recipe-tracker
Vercel:     prj_xxxxxxxxxxxx
Schema:     recipe_tracker
Services:   supabase
Access:     shared
```

**To start developing:**

```bash
cd ~/apps/recipe-tracker
cp .env.local.template .env.local
# Fill in .env.local with your actual values
npm run dev
```

**To deploy changes**, use the deploy command (see below), or just push to `main` — Vercel will pick it up automatically via its GitHub integration.

**Database schema**: Open `supabase/migrations/` to find your starter migration. Edit the placeholder columns to match your actual data model, then run `node bootstrap.js migrate --app recipe-tracker` to apply it.

**CI**: GitHub Actions runs unit and E2E tests on every push. Check the **Actions** tab in your repo.

---

## 7. Other Commands

### Deploy an app

Runs security scans, unit tests, and E2E tests, then commits and pushes all pending changes.

```bash
node deploy.js --app recipe-tracker
```

The deploy will be blocked if any security scans fail or if tests don't pass.

### Apply a database migration

After editing your migration files, apply them to the live Supabase project and regenerate TypeScript types:

```bash
node bootstrap.js migrate --app recipe-tracker
```

You'll be shown a list of pending migration files and asked to confirm before anything is applied.

### Deploy a single file change

For quick, focused updates with a targeted security check:

```bash
node bootstrap.js update --app recipe-tracker --file src/components/RecipeCard.tsx
```

Shows a git diff of the file and asks for confirmation before committing and pushing.

---

## 8. Troubleshooting

**Bootstrap fails at security scan**

Your source code contains a match for one of your `personal_data_flags`. Search for the flagged string and replace it with a placeholder or move it to an environment variable. The scanner reports file names and line numbers but never echoes the actual flag value in output.

**Supabase CLI not found**

Install it: `npm install -g @supabase/cli`. If it's installed but not found, check that your `npm bin` directory is on your `PATH`.

**Vercel domain verification stuck**

In the Vercel project dashboard, go to **Settings → Domains** and check the status. If it's still pending, wait a minute and then confirm in the bootstrap prompt. The Cloudflare proxy (orange cloud) won't be enabled until Vercel completes verification.

**Cloudflare Access blocking your own access after deploy**

The access policy attached in Phase 4.5 controls who can reach the app. Make sure your email is included in the Cloudflare Access policy you created. You can verify this in **Cloudflare Zero Trust → Access → Policies**.

**`DEBUG` mode**

Set `DEBUG=1` before running any command to see full error stack traces:

```bash
DEBUG=1 node bootstrap.js
```

**Apps manifest out of date**

`apps-manifest.json` in this repo is the registry of all bootstrapped apps. If you bootstrap an app on one machine and want to use the deploy or migrate commands on another, pull the latest `main` first.
