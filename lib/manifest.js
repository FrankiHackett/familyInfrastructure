// lib/manifest.js — apps-manifest.json read/write

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const MANIFEST_PATH = join(__dir, '..', 'apps-manifest.json')

function read() {
  if (!existsSync(MANIFEST_PATH)) return { apps: [], last_updated: null }
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  } catch {
    return { apps: [], last_updated: null }
  }
}

function write(manifest) {
  manifest.last_updated = new Date().toISOString()
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
}

export function getApp(name) {
  const manifest = read()
  return manifest.apps.find(a => a.name === name) || null
}

export function upsertApp(entry) {
  const manifest = read()
  const idx = manifest.apps.findIndex(a => a.name === entry.name)
  if (idx >= 0) {
    manifest.apps[idx] = { ...manifest.apps[idx], ...entry, updated_at: new Date().toISOString() }
  } else {
    manifest.apps.push({ ...entry, bootstrapped_at: new Date().toISOString() })
  }
  write(manifest)
}

export function listApps() {
  return read().apps
}
