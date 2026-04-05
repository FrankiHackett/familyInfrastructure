// lib/prompt.js — Interactive readline prompts for the bootstrap agent

import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'

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
 * Collect all inputs for a new app bootstrap.
 * Returns a fully-validated inputs object.
 */
export async function collectBootstrapInputs(cfg, iface) {
  const inputs = {}

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

  // Schema description (only if supabase)
  if (inputs.services.includes('supabase')) {
    console.log('\n  Describe the data this app needs to store.')
    console.log('  Example: "track triathlon sessions: discipline, distance, duration, date"')
    while (true) {
      const desc = (await ask(iface, '  Schema description:  ')).trim()
      if (desc.length >= 10) { inputs.schemaDescription = desc; break }
      console.log('  → Please provide at least a brief description (10+ chars).')
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
  if (inputs.schemaDescription) console.log(`  Schema:       ${inputs.schemaDescription}`)
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
