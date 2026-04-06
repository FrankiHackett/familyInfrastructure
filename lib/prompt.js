// lib/prompt.js — Interactive readline prompts for the bootstrap agent

import { createInterface } from 'node:readline'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REQUIRED, getPath, setPath, saveConfig } from './config.js'

function ask(iface, question) {
  return new Promise((resolve) => iface.question(question, resolve))
}

/**
 * Create the single readline interface for the entire bootstrap session.
 * Caller is responsible for closing it when done.
 */
export function createReadline() {
  return createInterface({ input: process.stdin, output: process.stdout })
}

/**
 * Prompt for any missing required config fields and save them to ~/.bootstrap-config.json.
 * Called at bootstrap start before app-specific prompts.
 */
export async function collectMissingConfig(cfg, iface) {
  const missing = REQUIRED.filter(([path]) => {
    const val = getPath(cfg, path)
    return !val || String(val).trim() === ''
  })
  if (missing.length === 0) return

  console.log('\n  ── Infrastructure Credentials ──────────────────────────────────')
  console.log(`  ${missing.length} required value(s) not found in ~/.bootstrap-config.json.`)
  console.log('  Provide them now — they will be saved (chmod 600) and never committed.\n')

  for (const [path, description] of missing) {
    let value
    while (!value) {
      value = (await ask(iface, `  ${description}:  `)).trim()
      if (!value) console.log('  → This field is required.')
    }
    setPath(cfg, path, value)
  }

  saveConfig(cfg)
  console.log('\n  Config saved to ~/.bootstrap-config.json\n')
}

/**
 * Prompt for credentials required by the selected services (anthropic, resend).
 * These are not in REQUIRED because they're only needed when the service is chosen.
 */
export async function collectServiceConfig(cfg, services, iface) {
  const needed = []

  if (services.includes('anthropic') && !cfg.anthropic?.api_key?.trim()) {
    needed.push(['anthropic.api_key', 'Anthropic API key (for ANTHROPIC_API_KEY server-side env var)'])
  }
  if (services.includes('resend')) {
    if (!cfg.resend?.api_key?.trim())
      needed.push(['resend.api_key', 'Resend API key'])
    if (!cfg.resend?.from_address?.trim())
      needed.push(['resend.from_address', 'Resend from address (e.g. noreply@example.com)'])
  }

  if (needed.length === 0) return

  console.log('\n  ── Service Credentials ─────────────────────────────────────────')
  console.log('  Missing credentials for the selected services:\n')

  for (const [path, description] of needed) {
    let value
    while (!value) {
      value = (await ask(iface, `  ${description}:  `)).trim()
      if (!value) console.log('  → This field is required for the selected service.')
    }
    setPath(cfg, path, value)
  }

  saveConfig(cfg)
  console.log('\n  Service credentials saved.\n')
}

/**
 * Offer to collect app-specific env vars for cfg.app_env_vars[appName].
 * Skipped if vars are already set for this app.
 */
export async function collectAppEnvVars(cfg, appName, iface) {
  const existing = cfg.app_env_vars?.[appName]
  if (existing && Object.keys(existing).length > 0) return

  console.log('\n  ── App-specific Environment Variables ──────────────────────────')
  console.log('  Does this app need any variables beyond the ones listed above?')
  console.log('  Format: KEY=value — leave blank to skip.\n')

  const vars = {}
  while (true) {
    const line = (await ask(iface, '  Variable (or Enter to skip):  ')).trim()
    if (!line) break
    const eqIdx = line.indexOf('=')
    if (eqIdx < 1) { console.log('  → Use format: KEY=value'); continue }
    const key   = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    if (!key) { console.log('  → Key cannot be empty'); continue }
    vars[key] = value
    console.log(`  + ${key}`)
  }

  if (Object.keys(vars).length > 0) {
    if (!cfg.app_env_vars) cfg.app_env_vars = {}
    cfg.app_env_vars[appName] = vars
    saveConfig(cfg)
    console.log(`\n  ${Object.keys(vars).length} variable(s) saved to config.\n`)
  }
}

/**
 * Collect all inputs for a new app bootstrap.
 * Returns a fully-validated inputs object.
 */
export async function collectBootstrapInputs(cfg, iface) {
  const inputs = {}

  // Ensure all required infrastructure config is present before proceeding
  await collectMissingConfig(cfg, iface)

  console.log('\n  Enter details for the new app. Press Ctrl+C to abort.\n')

  // App name
  while (true) {
    const name = (await ask(iface, '  App name (lowercase, hyphens OK):  ')).trim()
    if (/^[a-z][a-z0-9-]{1,38}$/.test(name)) { inputs.appName = name; break }
    console.log('  → Must be 2–39 chars, lowercase letters, digits, hyphens only.')
  }

  // Output directory
  const defaultDir = `/home/${process.env.USER || 'user'}/apps/${inputs.appName}`
  const dirInput = (await ask(iface, `  Create app at [${defaultDir}]:  `)).trim()
  inputs.appDir = dirInput || defaultDir

  // Source code to insert (optional)
  while (true) {
    const codePath = (await ask(iface, '  Existing source code path (Enter to skip):  ')).trim()
    if (!codePath) { inputs.codePath = null; break }
    if (existsSync(codePath)) { inputs.codePath = codePath; break }
    console.log(`  → Path not found: ${codePath}`)
  }

  // Owner
  while (true) {
    const owner = (await ask(iface, '  Owner — primary or partner [primary]:  ')).trim().toLowerCase() || 'primary'
    if (['primary', 'partner'].includes(owner)) { inputs.owner = owner; break }
    console.log('  → Enter "primary" or "partner".')
  }

  // Services
  console.log('\n  Services needed (comma-separated, or "none"):')
  console.log('    supabase  anthropic  resend  none')
  while (true) {
    const raw = (await ask(iface, '  Services [none]:  ')).trim().toLowerCase() || 'none'
    const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
    const valid = ['supabase', 'anthropic', 'resend', 'none']
    const bad = parts.filter(p => !valid.includes(p))
    if (bad.length) { console.log(`  → Unknown services: ${bad.join(', ')}`); continue }
    inputs.services = parts.includes('none') ? [] : parts
    break
  }

  // Collect credentials for any selected services that aren't yet in config
  await collectServiceConfig(cfg, inputs.services, iface)

  // Schema description (only if supabase)
  if (inputs.services.includes('supabase')) {
    const schemaFile = join(inputs.appDir, 'schema-description.md')
    if (existsSync(schemaFile)) {
      inputs.schemaDescription = readFileSync(schemaFile, 'utf-8').trim()
      console.log(`\n  Schema description loaded from schema-description.md`)
    } else {
      console.log('\n  Describe the data this app needs to store.')
      console.log('  Example: "track triathlon sessions: discipline, distance, duration, date"')
      console.log(`  Tip: save this to ${schemaFile} to skip this prompt next time.`)
      while (true) {
        const desc = (await ask(iface, '  Schema description:  ')).trim()
        if (desc.length >= 10) { inputs.schemaDescription = desc; break }
        console.log('  → Please provide at least a brief description (10+ chars).')
      }
    }
  } else {
    inputs.schemaDescription = null
  }

  // Access model
  console.log('\n  Access model:')
  console.log('    personal  — only you can see this data')
  console.log('    shared    — all household members')
  console.log('    partner   — you and your partner')
  while (true) {
    const model = (await ask(iface, '  Access model [personal]:  ')).trim().toLowerCase() || 'personal'
    if (['personal', 'shared', 'partner'].includes(model)) { inputs.accessModel = model; break }
    console.log('  → Enter "personal", "shared", or "partner".')
  }

  // Confirm before proceeding
  console.log('\n  ─────────────────────────────────────────────')
  console.log(`  App name:     ${inputs.appName}`)
  console.log(`  Directory:    ${inputs.appDir}`)
  console.log(`  Source code:  ${inputs.codePath || '(none)'}`)
  console.log(`  Owner:        ${inputs.owner}`)
  console.log(`  Services:     ${inputs.services.length ? inputs.services.join(', ') : 'none'}`)
  if (inputs.schemaDescription) {
    const schemaFile = join(inputs.appDir, 'schema-description.md')
    const source = existsSync(schemaFile) ? ' (from schema-description.md)' : ''
    console.log(`  Schema:       ${inputs.schemaDescription.split('\n')[0]}${source}`)
  }
  console.log(`  Access model: ${inputs.accessModel}`)
  console.log(`  Subdomain:    ${inputs.appName}.${cfg.cloudflare.household_domain}`)
  console.log('  ─────────────────────────────────────────────')

  const proceed = (await ask(iface, '\n  Proceed? [Y/n]:  ')).trim().toLowerCase()

  if (proceed === 'n' || proceed === 'no') {
    console.log('\n  Aborted.\n')
    process.exit(0)
  }

  return inputs
}

/**
 * Simple yes/no prompt for confirmations within phases.
 * Requires the shared readline interface created by createReadline().
 */
export async function confirm(question, iface) {
  const answer = (await ask(iface, `  ${question} [y/N]:  `)).trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
}
