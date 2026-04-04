// commands/update.js — bootstrap update --app [name] --file [path]
// Personal data check on the changed file, show diff, push to GitHub, trigger Vercel redeploy.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../lib/logger.js'
import { exec } from '../lib/exec.js'
import { getApp } from '../lib/manifest.js'
import { confirm } from '../lib/prompt.js'
import { runSecurity } from '../phases/02-security.js'

export async function runUpdate(cfg, argv) {
  const appIdx  = argv.indexOf('--app')
  const fileIdx = argv.indexOf('--file')
  const appName = appIdx  >= 0 ? argv[appIdx  + 1] : null
  const file    = fileIdx >= 0 ? argv[fileIdx + 1] : null

  if (!appName || !file) {
    console.error('Usage: bootstrap update --app <app-name> --file <path>')
    process.exit(1)
  }

  const appEntry = getApp(appName)
  if (!appEntry) {
    console.error(`App "${appName}" not found in apps-manifest.json.`)
    process.exit(1)
  }

  const appDir  = appEntry.code_path
  const fileFull = existsSync(file) ? file : join(appDir, file)

  if (!existsSync(fileFull)) {
    console.error(`File not found: ${fileFull}`)
    process.exit(1)
  }

  logger.raw(`\nUpdating ${appName} — ${fileFull.replace(appDir + '/', '')}`)

  // ── Phase 1: Personal data check on changed file ──────────────────────────
  logger.phase('1.5', 'Security (targeted)')
  // Pass a minimal fake inputs — security only needs the appDir
  await runSecurity(cfg, appDir)

  // ── Phase 2: Show diff ────────────────────────────────────────────────────
  logger.step('Git diff of changed file:')
  try {
    const { stdout } = await exec(`git diff HEAD -- "${fileFull}"`, { cwd: appDir })
    if (stdout) {
      logger.raw(stdout)
    } else {
      logger.info('  No staged changes. Is this a new file?')
      const { stdout: s2 } = await exec(`git status --short "${fileFull}"`, { cwd: appDir })
      logger.raw(s2)
    }
  } catch (err) {
    logger.warn(`Could not show diff: ${err.message}`)
  }

  const proceed = await confirm('Deploy this change?')
  if (!proceed) { logger.raw('Aborted.'); process.exit(0) }

  // ── Phase 3: Commit and push ──────────────────────────────────────────────
  logger.step('Staging and pushing change...')
  await exec(`git add "${fileFull}"`, { cwd: appDir })

  try {
    await exec(`git commit -m "update: ${fileFull.replace(appDir + '/', '')}"`, { cwd: appDir })
    logger.success('Change committed.')
  } catch {
    logger.warn('Nothing to commit — file may already be staged.')
  }

  // Push with authenticated remote temporarily
  const repoFull = appEntry.github_repo
  const authedUrl = `https://x-access-token:${cfg.github.token}@github.com/${repoFull}.git`
  await exec(`git remote set-url origin ${authedUrl}`, { cwd: appDir })
  await exec('git push origin main', { cwd: appDir })
  await exec(`git remote set-url origin https://github.com/${repoFull}.git`, { cwd: appDir })

  logger.success('Change pushed to GitHub.')

  // Vercel picks up the push automatically via GitHub integration.
  logger.info('Vercel will detect the push and trigger a new deployment.')
  logger.info(`Check status: https://vercel.com/dashboard`)

  if (appEntry.protected_url) {
    logger.success(`Live at: ${appEntry.protected_url}`)
  }
}
