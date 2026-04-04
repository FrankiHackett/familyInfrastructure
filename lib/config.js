// lib/config.js — Load and validate ~/.bootstrap-config.json at startup.
// All values are returned as an opaque object. Never log field values.

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_PATH = join(homedir(), '.bootstrap-config.json')

const REQUIRED = [
  ['github.token',                 'GitHub personal access token'],
  ['github.username',              'GitHub username'],
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
function getPath(obj, dotPath) {
  return dotPath.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), obj)
}

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
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
