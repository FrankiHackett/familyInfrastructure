#!/usr/bin/env node
// deploy.js — Test-gated deploy for an existing household app.
// Runs privacy scan + smoke tests before committing and pushing to GitHub.
// Vercel picks up the push automatically via GitHub integration.
//
// Usage:
//   node deploy.js --app <name>

import { loadConfig }                from './lib/config.js'
import { logger }                    from './lib/logger.js'
import { getApp }                    from './lib/manifest.js'
import { exec, spawn }               from './lib/exec.js'
import { createReadline, confirm }   from './lib/prompt.js'
import { runSecurity }               from './phases/02-security.js'

// ─── Entry point ──────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const appIdx  = args.indexOf('--app')
const appName = appIdx >= 0 ? args[appIdx + 1] : null

if (!appName) {
  console.error('Usage: node deploy.js --app <app-name>')
  process.exit(1)
}

const cfg = loadConfig()

const appEntry = getApp(appName)
if (!appEntry) {
  console.error(`App "${appName}" not found in apps-manifest.json.`)
  process.exit(1)
}

const { code_path: appDir, protected_url: liveUrl, github_repo: repoFull } = appEntry

const iface = createReadline()

try {
  await runDeploy()
} catch (err) {
  logger.block(err.message || String(err))
  if (process.env.DEBUG) console.error(err)
  process.exit(1)
} finally {
  iface.close()
}

// ─── Main deploy flow ─────────────────────────────────────────────────────────

async function runDeploy() {
  printBanner(appName)

  // ── Phase 1: Privacy + secrets scan ────────────────────────────────────────
  await runSecurity(cfg, appDir, iface)

  // ── Phase 2: Unit / integration tests ──────────────────────────────────────
  logger.phase('2', 'Unit & Integration Tests')
  logger.step('Running vitest...')
  try {
    await spawn('npm', ['run', 'test:run'], { cwd: appDir })
    logger.success('Unit tests passed')
  } catch {
    throw new Error('Unit tests failed — fix before deploying.')
  }

  // ── Phase 3: E2E smoke tests against live URL ───────────────────────────────
  logger.phase('3', 'E2E Smoke Tests')
  if (liveUrl) {
    logger.step(`Running Playwright against ${liveUrl}...`)
    try {
      await spawn('npx', ['playwright', 'test'], {
        cwd: appDir,
        env: { PLAYWRIGHT_BASE_URL: liveUrl },
      })
      logger.success('E2E smoke tests passed')
    } catch {
      throw new Error('E2E tests failed — fix before deploying.')
    }
  } else {
    logger.warn('No protected_url in manifest — E2E tests skipped')
  }

  // ── Phase 4: Review changes ─────────────────────────────────────────────────
  logger.phase('4', 'Changes')
  let hasChanges = false
  try {
    const { stdout: status } = await exec('git status --short', { cwd: appDir })
    if (status) {
      logger.raw('\n' + status)
      hasChanges = true
    } else {
      logger.warn('No changes detected — nothing to push.')
      return
    }
  } catch (err) {
    logger.warn(`Could not check git status: ${err.message}`)
  }

  if (!hasChanges) return

  const proceed = await confirm('Deploy these changes to GitHub?', iface)
  if (!proceed) { logger.raw('Aborted.'); return }

  // ── Phase 5: Commit and push ────────────────────────────────────────────────
  logger.phase('5', 'Push')
  logger.step('Staging all changes...')
  await exec('git add -A', { cwd: appDir })

  const { stdout: staged } = await exec('git diff --cached --name-only', { cwd: appDir })
  if (!staged) {
    logger.warn('Nothing new to commit.')
    return
  }

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  await exec(`git commit -m "deploy: ${appName} ${timestamp}"`, { cwd: appDir })
  logger.success('Changes committed.')

  // Use a temporary authenticated remote — reset to plain HTTPS afterwards.
  // Token never appears in git history or logs.
  const authedUrl = `https://x-access-token:${cfg.github.token}@github.com/${repoFull}.git`
  await exec(`git remote set-url origin "${authedUrl}"`, { cwd: appDir })
  await exec('git push origin main', { cwd: appDir })
  await exec(`git remote set-url origin "https://github.com/${repoFull}.git"`, { cwd: appDir })

  logger.success('Pushed to GitHub — Vercel will deploy automatically.')
  if (liveUrl) logger.success(`Live at: ${liveUrl}`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function printBanner(name) {
  console.log('\n\x1b[1m\x1b[36m')
  console.log('  ╔════════════════════════════════════════════════╗')
  console.log('  ║        Household App Deploy Agent              ║')
  console.log('  ║   Security → Tests → E2E → Push               ║')
  console.log('  ╚════════════════════════════════════════════════╝')
  console.log('\x1b[0m')
  console.log(`  Deploying: \x1b[1m${name}\x1b[0m\n`)
}
