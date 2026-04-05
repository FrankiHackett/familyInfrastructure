// phases/06-access.js — Configure Cloudflare Access: DNS CNAME + Access Application + Policy

import { logger } from '../lib/logger.js'
import { cloudflare } from '../lib/api.js'
import { confirm } from '../lib/prompt.js'

export async function runAccess(cfg, inputs, vercelDeploymentUrl, iface) {
  logger.phase('4.5', 'Access Protection')

  const { appName } = inputs
  const subdomain   = `${appName}.${cfg.cloudflare.household_domain}`

  // Vercel custom domains behind Cloudflare proxy must CNAME to cname.vercel-dns.com.
  // Pointing at a *.vercel.app deployment URL causes SSL errors because that cert
  // only covers *.vercel.app, not the custom subdomain — Cloudflare's origin SSL
  // handshake then fails with "unable to establish an SSL connection".
  const cnameTarget = 'cname.vercel-dns.com'

  // ── DNS Record ────────────────────────────────────────────────────────────
  logger.step(`Configuring DNS: ${subdomain} → ${cnameTarget}`)

  const existing = await cloudflare.findDnsRecord(cfg, subdomain)

  if (existing) {
    if (existing.content === cnameTarget) {
      logger.info(`  DNS record already correct — skipping`)
    } else {
      logger.warn(`  Existing record points to: ${existing.content}`)
      logger.step(`  Updating to: ${cnameTarget}`)
      await cloudflare.updateDnsRecord(cfg, existing.id, cnameTarget)
      logger.success('DNS record updated')
    }
  } else {
    await cloudflare.createDnsRecord(cfg, { name: subdomain, content: cnameTarget })
    logger.success(`DNS CNAME created (proxied): ${subdomain} → ${cnameTarget}`)
  }

  // ── Access Application ────────────────────────────────────────────────────
  logger.step(`Creating Cloudflare Access application for ${subdomain}`)

  let accessApp = await cloudflare.findAccessApp(cfg, subdomain)

  if (accessApp) {
    logger.warn(`Access application already exists (id: ${accessApp.id}) — reusing`)
  } else {
    accessApp = await cloudflare.createAccessApp(cfg, { name: appName, domain: subdomain })
    logger.success(`Access application created (id: ${accessApp.id})`)
  }

  // ── Attach Policy ─────────────────────────────────────────────────────────
  logger.step('Attaching household access policy...')

  // Check if policy already attached
  let policies = []
  try {
    policies = await cloudflare.listAccessAppPolicies(cfg, accessApp.id) || []
  } catch {
    policies = []
  }

  const alreadyAttached = Array.isArray(policies) && policies.some(
    p => p.id === cfg.cloudflare.access_policy_id
  )

  if (alreadyAttached) {
    logger.info('  Household policy already attached')
  } else {
    await cloudflare.attachPolicy(cfg, accessApp.id)
    logger.success('Household access policy attached')
  }

  // ── Result ────────────────────────────────────────────────────────────────
  const protectedUrl = `https://${subdomain}`
  logger.success(`Phase 4.5 complete — protected URL: ${protectedUrl}`)

  logger.info(`Vercel domain check: confirm ${subdomain} is verified in Vercel before continuing.`)
  logger.info(`  Vercel → your project → Settings → Domains → look for a green checkmark next to ${subdomain}`)
  logger.info('  (The domain was added automatically in Phase 4. If it shows "Invalid Configuration", it is still working — this clears on its own.)')
  await confirm(`Press y once ${subdomain} shows as verified in Vercel to continue`, iface)

  return { subdomain, protectedUrl, accessAppId: accessApp.id }
}
