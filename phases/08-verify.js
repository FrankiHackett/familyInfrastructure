// phases/08-verify.js — Poll for Vercel deployment, run smoke tests, print summary

import { logger } from '../lib/logger.js'
import { vercel } from '../lib/api.js'
import { exec } from '../lib/exec.js'

const POLL_INTERVAL_MS  = 10_000   // 10 seconds
const POLL_TIMEOUT_MS   = 300_000  // 5 minutes

export async function runVerify(cfg, inputs, appDir, vercelProjectId, protectedUrl) {
  logger.phase('6', 'Verify')

  // ── Wait for Vercel deployment to go READY ────────────────────────────────
  logger.step('Waiting for Vercel deployment to reach READY state...')

  const deployment = await waitForDeployment(cfg, vercelProjectId)

  if (!deployment) {
    logger.warn('Deployment did not reach READY state within 5 minutes.')
    logger.info('  Check Vercel dashboard for deployment status.')
    logger.info('  Run smoke tests manually once deployed: npm run test:e2e')
    return { verified: false }
  }

  logger.success(`Deployment READY: ${deployment.url ? 'https://' + deployment.url : 'deployed'}`)

  // ── Run Playwright smoke tests against the protected URL ──────────────────
  logger.step(`Running smoke tests against ${protectedUrl}`)

  try {
    await exec(
      `npx playwright test tests/e2e/smoke.spec.ts --reporter=line`,
      {
        cwd: appDir,
        env: {
          PLAYWRIGHT_BASE_URL: protectedUrl,
          CI: '1',
        },
      }
    )
    logger.success('Smoke tests passed')
    return { verified: true, deploymentUrl: deployment.url }
  } catch (err) {
    logger.warn('Smoke tests failed against live deployment.')
    logger.info('  This may be expected if Cloudflare Access is blocking unauthenticated requests.')
    logger.info('  Check Playwright report: npx playwright show-report')
    logger.info(err.message.split('\n')[0])
    return { verified: false, deploymentUrl: deployment.url }
  }
}

async function waitForDeployment(cfg, projectId) {
  const start = Date.now()

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const deployment = await vercel.getLatestDeployment(cfg, projectId).catch(() => null)

    if (deployment) {
      const state = deployment.state || deployment.readyState
      logger.info(`  Deployment state: ${state}`)

      if (state === 'READY')  return deployment
      if (state === 'ERROR' || state === 'CANCELED') {
        logger.error(`Deployment failed with state: ${state}`)
        return null
      }
    }

    await sleep(POLL_INTERVAL_MS)
  }

  return null
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function printSummary(inputs, results) {
  const { appName } = inputs
  const lines = [
    ['App',          appName],
    ['Protected URL', results.protectedUrl || '(not set)'],
    ['GitHub repo',   results.repoUrl || '(not set)'],
    ['Vercel project',results.projectId || '(not set)'],
    ['Schema',        inputs.services.includes('supabase') ? inputs.appName.replace(/-/g, '_') : 'N/A'],
    ['Services',      inputs.services.length ? inputs.services.join(', ') : 'none'],
    ['Access model',  inputs.accessModel],
    ['Smoke tests',   results.verified ? '✓ passed' : '⚠ check manually'],
  ]
  logger.summary(lines)

  logger.raw('  Next steps:')
  logger.raw(`  1. Add ${results.subdomain} as a custom domain in Vercel (if not done)`)
  logger.raw('  2. Verify Cloudflare Access blocks unauthenticated requests')
  if (inputs.services.includes('supabase')) {
    logger.raw('  3. Review and refine your migration in migrations/ then run:')
    logger.raw(`       node bootstrap.js migrate --app ${appName}`)
  }
  logger.raw(`  4. Push new code to the dev branch; CI will run on PRs to main`)
  logger.raw('')
}
