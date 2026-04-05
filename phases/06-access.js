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

  // ── DNS Record (unproxied first so Vercel can verify) ────────────────────
  // Cloudflare proxy (orange cloud) hides the CNAME target from Vercel's
  // domain verification check, causing permanent "Invalid Configuration".
  // Solution: create unproxied → wait for Vercel to verify → switch to proxied.
  logger.step(`Configuring DNS: ${subdomain} → ${cnameTarget} (unproxied for Vercel verification)`)

  const existing = await cloudflare.findDnsRecord(cfg, subdomain)
  let dnsRecordId

  if (existing) {
    dnsRecordId = existing.id
    if (existing.content === cnameTarget && !existing.proxied) {
      logger.info(`  DNS record already unproxied and correct — skipping`)
    } else {
      await cloudflare.updateDnsRecord(cfg, existing.id, cnameTarget, { proxied: false })
      logger.success('DNS record updated (unproxied)')
    }
  } else {
    const record = await cloudflare.createDnsRecord(cfg, { name: subdomain, content: cnameTarget, proxied: false })
    dnsRecordId = record.id
    logger.success(`DNS CNAME created (unproxied): ${subdomain} → ${cnameTarget}`)
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

  // ── Wait for Vercel verification, then enable Cloudflare proxy ───────────
  const protectedUrl = `https://${subdomain}`

  logger.info('')
  logger.info(`Vercel must verify the domain before proxy can be enabled.`)
  logger.info(`  Vercel → ${inputs.appName} project → Settings → Domains`)
  logger.info(`  Wait for a green checkmark next to ${subdomain}, then press y.`)
  await confirm(`Press y once ${subdomain} shows as verified in Vercel`, iface)

  logger.step('Enabling Cloudflare proxy (orange cloud)...')
  await cloudflare.updateDnsRecord(cfg, dnsRecordId, cnameTarget, { proxied: true })
  logger.success('Cloudflare proxy enabled')

  // ── Result ────────────────────────────────────────────────────────────────
  logger.success(`Phase 4.5 complete — protected URL: ${protectedUrl}`)

  return { subdomain, protectedUrl, accessAppId: accessApp.id }
}
