#!/usr/bin/env node
// bootstrap.js — Household App Infrastructure bootstrap agent
// Orchestrates 6 phases to take a new app from zero to deployed.
//
// Usage:
//   node bootstrap.js                          — interactive bootstrap
//   node bootstrap.js migrate --app <name>     — apply pending migrations
//   node bootstrap.js update  --app <name> --file <path>  — check + deploy a file change

import { loadConfig }    from './lib/config.js'
import { logger }        from './lib/logger.js'
import { upsertApp }     from './lib/manifest.js'
import { createReadline, collectBootstrapInputs } from './lib/prompt.js'
import { runMigrate }    from './commands/migrate.js'
import { runUpdate }     from './commands/update.js'
import { runScaffold }   from './phases/01-scaffold.js'
import { runSecurity }   from './phases/02-security.js'
import { runGithub }     from './phases/03-github.js'
import { runSupabase }   from './phases/04-supabase.js'
import { runVercel }     from './phases/05-vercel.js'
import { runAccess }     from './phases/06-access.js'
import { runTests }      from './phases/07-tests.js'
import { runVerify, printSummary } from './phases/08-verify.js'

// ─── Entry point ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const cmd  = args[0]

// Migrate/update need a complete config upfront; bootstrap collects missing values interactively.
const cfg = loadConfig({ lenient: !cmd })

if (cmd === 'migrate') {
  await runMigrate(cfg, args).catch(fatal)
} else if (cmd === 'update') {
  await runUpdate(cfg, args).catch(fatal)
} else {
  await runBootstrap(cfg).catch(fatal)
}

// ─── Main bootstrap flow ──────────────────────────────────────────────────────

async function runBootstrap(cfg) {
  printBanner()

  // Single readline interface for the entire bootstrap session.
  // Never closed mid-run — only in the finally block below.
  const iface = createReadline()

  try {
    // Collect interactive inputs
    const inputs = await collectBootstrapInputs(cfg, iface)

    // Accumulate results across phases for the final summary
    const results = {}

    // ── Phase 1: Scaffold ───────────────────────────────────────────────────
    const { appDir, migrationFile } = await runScaffold(inputs)
    // Thread migration file explicitly so Phase 3 has a guaranteed reference
    if (migrationFile) inputs._migrationFile = migrationFile

    // ── Phase 1.5: Security ─────────────────────────────────────────────────
    await runSecurity(cfg, appDir, iface)

    // ── Phase 2: GitHub ─────────────────────────────────────────────────────
    const { repoFull, repoUrl } = await runGithub(cfg, inputs, appDir)
    results.repoFull = repoFull
    results.repoUrl  = repoUrl

    // ── Phase 3: Supabase (conditional) ────────────────────────────────────
    if (inputs.services.includes('supabase')) {
      await runSupabase(cfg, inputs, appDir, iface)
    } else {
      logger.phase('3', 'Supabase')
      logger.info('Supabase not in services — Phase 3 skipped')
    }

    // ── Phase 4: Vercel ─────────────────────────────────────────────────────
    const { projectId, subdomain } = await runVercel(cfg, inputs, appDir, repoFull, iface)
    results.projectId = projectId
    results.subdomain = subdomain

    // ── Phase 4.5: Access Protection ───────────────────────────────────────
    // Use the Vercel project's default URL as the CNAME target for now.
    // Vercel assigns a stable URL of the form <project-name>.vercel.app
    const vercelTarget = `${inputs.appName}.vercel.app`
    const { protectedUrl, accessAppId } = await runAccess(cfg, inputs, vercelTarget, iface)
    results.protectedUrl = protectedUrl
    results.accessAppId  = accessAppId

    // ── Phase 5: Tests ──────────────────────────────────────────────────────
    await runTests(cfg, inputs, appDir)

    // ── Phase 6: Verify ─────────────────────────────────────────────────────
    const { verified } = await runVerify(cfg, inputs, appDir, projectId, protectedUrl)
    results.verified = verified

    // ── Update apps-manifest.json ───────────────────────────────────────────
    upsertApp({
      name:                  inputs.appName,
      schema_namespace:      inputs.appName.replace(/-/g, '_'),
      owner:                 inputs.owner,
      services:              inputs.services,
      access_model:          inputs.accessModel,
      subdomain,
      protected_url:         protectedUrl,
      vercel_project_id:     projectId,
      github_repo:           repoFull,
      cloudflare_access_app: accessAppId,
      code_path:             appDir,
    })

    // ── Final Summary ───────────────────────────────────────────────────────
    printSummary(inputs, results)
  } finally {
    iface.close()
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fatal(err) {
  logger.block(err.message || String(err))
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
}

function printBanner() {
  console.log('\n\x1b[1m\x1b[36m')
  console.log('  ╔════════════════════════════════════════════════╗')
  console.log('  ║     Household App Infrastructure Bootstrap     ║')
  console.log('  ║   Zero → Deployed household app in 6 phases   ║')
  console.log('  ╚════════════════════════════════════════════════╝')
  console.log('\x1b[0m')
}
