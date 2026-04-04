// commands/migrate.js — bootstrap migrate --app [name]
// Applies pending migrations to the live Supabase project for the named app.

import { readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../lib/logger.js'
import { exec, toolExists } from '../lib/exec.js'
import { getApp } from '../lib/manifest.js'
import { confirm } from '../lib/prompt.js'

export async function runMigrate(cfg, argv) {
  const appIdx  = argv.indexOf('--app')
  const appName = appIdx >= 0 ? argv[appIdx + 1] : null

  if (!appName) {
    console.error('Usage: bootstrap migrate --app <app-name>')
    process.exit(1)
  }

  const appEntry = getApp(appName)
  if (!appEntry) {
    console.error(`App "${appName}" not found in apps-manifest.json. Run bootstrap first.`)
    process.exit(1)
  }

  const appDir = appEntry.code_path
  if (!existsSync(appDir)) {
    console.error(`App directory not found: ${appDir}`)
    process.exit(1)
  }

  if (!(await toolExists('supabase'))) {
    console.error('supabase CLI not found. Install: https://supabase.com/docs/guides/cli/getting-started')
    process.exit(1)
  }

  const migrationsDir = join(appDir, 'migrations')
  if (!existsSync(migrationsDir)) {
    console.error(`No migrations/ directory found in ${appDir}`)
    process.exit(1)
  }

  // List migration files
  const migrationFiles = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  if (migrationFiles.length === 0) {
    console.log('No migration files found.')
    process.exit(0)
  }

  logger.raw(`\nMigrations to apply (${migrationFiles.length}):`)
  for (const f of migrationFiles) logger.raw(`  ${f}`)

  const ok = await confirm(`Apply ${migrationFiles.length} migration(s) to Supabase project ${cfg.supabase.project_ref}?`)
  if (!ok) { logger.raw('Aborted.'); process.exit(0) }

  logger.step('Running supabase db push...')
  await exec('supabase db push', {
    cwd: appDir,
    env: { SUPABASE_ACCESS_TOKEN: cfg.supabase.access_token },
  })
  logger.success('Migrations applied successfully.')

  // Regenerate types after migration — capture stdout, write via Node (no shell redirect)
  const schema = appEntry.schema_namespace || appName.replace(/-/g, '_')
  logger.step('Regenerating TypeScript types...')
  const { stdout: typesOutput } = await exec(
    `supabase gen types typescript --project-ref ${cfg.supabase.project_ref} --schema ${schema}`,
    { cwd: appDir, env: { SUPABASE_ACCESS_TOKEN: cfg.supabase.access_token } }
  )
  writeFileSync(join(appDir, 'src', 'types', 'database.types.ts'), typesOutput, 'utf-8')
  logger.success('Types regenerated: src/types/database.types.ts')

  // Commit updated types
  await exec('git add -A', { cwd: appDir })
  try {
    await exec(`git commit -m "chore: regenerate types after migration"`, { cwd: appDir })
    logger.success('Updated types committed.')
  } catch {
    // Nothing staged — types unchanged
    logger.info('No type changes to commit.')
  }

  logger.success(`Migration complete for ${appName}`)
}
