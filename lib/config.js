// lib/config.js — Load and validate ~/.bootstrap-config.json at startup.
// All values are returned as an opaque object. Never log field values.

import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_PATH = join(homedir(), '.bootstrap-config.json')

export const REQUIRED = [
  ['github.token',                 'GitHub personal access token'],
  ['github.username',              'GitHub username'],
  ['github.email',                 'GitHub commit email address'],
  ['cloudflare.account_id',        'Cloudflare account ID'],
  ['cloudflare.zone_id',           'Cloudflare zone ID'],
  ['cloudflare.household_domain',  'Household domain (e.g. example.com)'],
  ['cloudflare.access_policy_id',  'Cloudflare Access reusable policy ID'],
  ['cloudflare.api_token',         'Cloudflare API token'],
  ['vercel.api_token',             'Vercel API token'],
  ['supabase.project_ref',         'Supabase project ref'],
  ['supabase.project_url',         'Supabase project URL'],
  ['supabase.anon_key',            'Supabase anonymous key (client-safe)'],
  ['supabase.service_role_key',    'Supabase service role key (server-only)'],
  ['supabase.access_token',        'Supabase CLI access token'],
]

// Resolve a dotted path like 'cloudflare.zone_id' from a nested object
export function getPath(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), obj)
}

// Set a dotted path on a nested object, creating intermediate objects as needed
export function setPath(obj, dotPath, value) {
  const parts = dotPath.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

// Write cfg back to ~/.bootstrap-config.json with secure permissions
export function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
  chmodSync(CONFIG_PATH, 0o600)
}

/**
 * Load and optionally validate ~/.bootstrap-config.json.
 *
 * lenient: false (default) — exit immediately if file missing or fields absent.
 *          Used by migrate/update commands that need a full config upfront.
 * lenient: true  — return partial config without exiting; callers are expected
 *          to collect missing values interactively (bootstrap flow only).
 */
export function loadConfig({ lenient = false } = {}) {
  if (!existsSync(CONFIG_PATH)) {
    if (lenient) return {}
    console.error(`\nERROR: ~/.bootstrap-config.json not found.`)
    console.error(`Create it at: ${CONFIG_PATH}`)
    console.error(`See skills/personal-data-protection/references/bootstrap-config-schema.md for schema.\n`)
    process.exit(1)
  }

  let cfg
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch (err) {
    console.error(`\nERROR: Failed to parse ~/.bootstrap-config.json: ${err.message}\n`)
    process.exit(1)
  }

  const missing = []
  for (const [path, description] of REQUIRED) {
    const val = getPath(cfg, path)
    if (!val || String(val).trim() === '') {
      missing.push(`  ${path.padEnd(40)} ${description}`)
    }
  }

  if (missing.length > 0) {
    if (lenient) return cfg
    console.error(`\nERROR: Missing required fields in ~/.bootstrap-config.json:`)
    console.error(missing.join('\n'))
    console.error(`\nFill these fields and re-run.\n`)
    process.exit(1)
  }

  // Log field names loaded (never values)
  console.log(`Config loaded from ${CONFIG_PATH}`)
  console.log(`  Fields present: ${REQUIRED.map(([p]) => p).join(', ')}`)

  return cfg
}
