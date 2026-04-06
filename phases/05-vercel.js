// phases/05-vercel.js — Create Vercel project, inject env vars, configure domain

import { logger } from '../lib/logger.js'
import { vercel } from '../lib/api.js'
import { collectAppEnvVars } from '../lib/prompt.js'

export async function runVercel(cfg, inputs, appDir, repoFull, iface) {
  logger.phase('4', 'Vercel')

  const { appName, services } = inputs
  const subdomain = `${appName}.${cfg.cloudflare.household_domain}`

  // 4a. Create Vercel project (skip if already exists)
  logger.step(`Creating Vercel project: ${appName}`)
  let project = await vercel.getProjectByName(cfg, appName)

  if (project) {
    logger.warn(`Vercel project "${appName}" already exists — reusing`)
  } else {
    project = await vercel.createProject(cfg, {
      name:       appName,
      repoFullName: repoFull,
      framework:  'vite',
    })
    logger.success(`Vercel project created (id: ${project.id})`)
  }

  const projectId = project.id

  // 4b. Inject environment variables
  // Show the standard vars first so the user knows what's already covered,
  // then ask if any app-specific additions are needed.
  logger.step('Preparing environment variables...')
  const standardVars = buildEnvVars(cfg, inputs)
  logger.info('  Standard vars to be injected:')
  for (const v of standardVars) logger.info(`    ${v.key}`)

  await collectAppEnvVars(cfg, inputs.appName, appDir, standardVars.map(v => v.key), iface)

  logger.step('Injecting environment variables...')
  const envVars = buildEnvVars(cfg, inputs)
  let injected = 0

  for (const ev of envVars) {
    try {
      await vercel.addEnvVar(cfg, projectId, ev)
      // Log key name only — never the value
      logger.info(`  + ${ev.key}`)
      injected++
    } catch (err) {
      // 409 = already exists — treat as success
      if (err.message.includes('409') || err.message.toLowerCase().includes('already exists')) {
        logger.info(`  ~ ${ev.key} (already set)`)
      } else {
        throw new Error(`Failed to set ${ev.key}: ${err.message}`)
      }
    }
  }

  logger.success(`${injected} env vars injected`)

  // 4c. Add custom domain
  logger.step(`Adding custom domain: ${subdomain}`)
  try {
    await vercel.addDomain(cfg, projectId, subdomain)
    logger.success(`Custom domain added: ${subdomain}`)
  } catch (err) {
    if (err.message.includes('409') || err.message.toLowerCase().includes('already exists')) {
      logger.warn(`Domain already configured: ${subdomain}`)
    } else {
      // Non-fatal — Cloudflare DNS must be set first; domain can be added later
      logger.warn(`Could not add domain automatically: ${err.message}`)
      logger.info(`  Add manually in Vercel dashboard after DNS is configured.`)
    }
  }

  logger.success(`Phase 4 complete — Vercel project: ${appName}`)
  return { projectId, subdomain }
}

/**
 * Build env var list from config values for the selected services.
 * Values come from config — this function only names them.
 */
function buildEnvVars(cfg, inputs) {
  const { services } = inputs
  const vars = []

  // App URL — set to the Cloudflare subdomain (filled after Phase 4.5)
  vars.push({
    key:    'VITE_APP_URL',
    value:  `https://${inputs.appName}.${cfg.cloudflare.household_domain}`,
    target: ['production', 'preview', 'development'],
    type:   'plain',
  })

  if (services.includes('supabase')) {
    vars.push(
      {
        key:    'VITE_SUPABASE_URL',
        value:  cfg.supabase.project_url,
        target: ['production', 'preview', 'development'],
        type:   'plain',
      },
      {
        key:    'VITE_SUPABASE_ANON_KEY',
        value:  cfg.supabase.anon_key || '',
        target: ['production', 'preview', 'development'],
        type:   'encrypted',
      },
      {
        key:    'SUPABASE_SERVICE_ROLE_KEY',
        value:  cfg.supabase.service_role_key,
        target: ['production'],
        type:   'encrypted',
      }
    )
  }

  if (services.includes('anthropic')) {
    vars.push({
      key:    'ANTHROPIC_API_KEY',
      value:  cfg.anthropic?.api_key || '',
      target: ['production'],
      type:   'encrypted',
    })
  }

  if (services.includes('resend')) {
    vars.push(
      {
        key:    'RESEND_API_KEY',
        value:  cfg.resend?.api_key || '',
        target: ['production'],
        type:   'encrypted',
      },
      {
        key:    'RESEND_FROM_ADDRESS',
        value:  cfg.resend?.from_address || '',
        target: ['production'],
        type:   'plain',
      }
    )
  }

  // App-specific env vars from cfg.app_env_vars[appName]
  const appSpecific = cfg.app_env_vars?.[inputs.appName]
  if (appSpecific && typeof appSpecific === 'object') {
    for (const [key, value] of Object.entries(appSpecific)) {
      vars.push({
        key,
        value,
        target: ['production', 'preview', 'development'],
        type:   'plain',
      })
    }
  }

  // Filter out vars with empty values and warn
  return vars.filter(v => {
    if (!v.value) {
      logger.warn(`  Skipping ${v.key} — value not set in config`)
      return false
    }
    return true
  })
}
