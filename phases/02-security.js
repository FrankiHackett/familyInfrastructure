// phases/02-security.js — Personal data scan + gitleaks pre-push check

import { readdirSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { logger } from '../lib/logger.js'
import { exec, toolExists } from '../lib/exec.js'
import { confirm } from '../lib/prompt.js'

// File extensions to scan for text content
const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.env', '.md', '.sql', '.sh', '.yaml', '.yml',
])

// Directories to skip entirely
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  'playwright-report', 'test-results',
])

// Specific filenames to skip — lock files contain only package hashes and are
// irrelevant to privacy auditing but are extremely token-heavy (SHA-512 base64
// strings tokenise at ~1–2 chars/token, easily consuming tens of thousands of
// tokens from the model's context window).
const SKIP_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'composer.lock',
  'Gemfile.lock', 'poetry.lock', 'Cargo.lock',
])

/**
 * Recursively collect all scannable files under rootDir.
 */
function collectFiles(rootDir) {
  const files = []
  function walk(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (SCAN_EXTENSIONS.has(extname(entry.name)) && !SKIP_FILES.has(entry.name)) files.push(full)
    }
  }
  walk(rootDir)
  return files
}

/**
 * Pass 1: string scan against personal_data_flags and partner_personal_data_flags
 * from the config. Flags are treated as opaque — never logged.
 * Returns array of { flag_index, source_array, file, lines }
 */
function runStringsScan(cfg, appDir) {
  const personalFlags   = Array.isArray(cfg.personal_data_flags)         ? cfg.personal_data_flags         : []
  const partnerFlags    = Array.isArray(cfg.partner_personal_data_flags)  ? cfg.partner_personal_data_flags  : []
  const allFlags        = [
    ...personalFlags.map((f, i) => ({ flag: f, source: 'personal_data_flags',        index: i })),
    ...partnerFlags .map((f, i) => ({ flag: f, source: 'partner_personal_data_flags', index: i })),
  ].filter(({ flag }) => flag && String(flag).trim().length > 0)

  logger.info(`Scanning with ${personalFlags.length} personal flags, ${partnerFlags.length} partner flags`)

  if (allFlags.length === 0) {
    logger.warn('No personal data flags configured — Pass 1 skipped')
    return []
  }

  const files = collectFiles(appDir)
  const findings = []

  for (const { flag, source, index } of allFlags) {
    for (const file of files) {
      let content
      try { content = readFileSync(file, 'utf-8') } catch { continue }

      if (content.includes(flag)) {
        const matchedLines = content
          .split('\n')
          .map((line, i) => ({ line: i + 1, has: line.includes(flag) }))
          .filter(l => l.has)
          .map(l => l.line)

        findings.push({
          // Report by array source and index — never echo the flag value itself
          label:  `[${source}[${index}]]`,
          file:   file.replace(appDir + '/', ''),
          lines:  matchedLines,
        })
      }
    }
  }

  return findings
}

/**
 * Pass 2: LLM judgement via Anthropic Messages API.
 * Sends all collected file contents to the LLM and parses a findings array.
 * Never logs actual flag values or file content — only file path, line, and reason.
 * Returns array of { file, line, value_description, confidence, reason }
 */
async function runLlmScan(cfg, appDir) {
  const apiKey = cfg.anthropic?.api_key
  if (!apiKey) {
    logger.warn('Anthropic API key not configured — Pass 2 (LLM scan) skipped')
    return []
  }

  const files = collectFiles(appDir)
  const parts = []
  for (const file of files) {
    let content
    try { content = readFileSync(file, 'utf-8') } catch { continue }
    parts.push(`=== ${file.replace(appDir + '/', '')} ===\n${content}`)
  }

  const SYSTEM_PROMPT =
    "You are a privacy auditor. Review the following code and identify any hardcoded values " +
    "that appear to describe a specific real person, household, or location. Focus on: template " +
    "literals and strings passed to LLM APIs, default values that look like real personal data, " +
    "comments containing identifying details, and any test or seed data using real names or places. " +
    "Return a JSON array of findings, each with: { file, line, value_description, confidence: " +
    "'high' | 'medium' | 'low', reason }. If no findings, return an empty array. " +
    "Return ONLY the JSON array, no other text."

  let response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: parts.join('\n\n') }],
      }),
    })
  } catch (err) {
    logger.warn(`Pass 2: Anthropic API request failed (${err.message}) — LLM scan skipped`)
    return []
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => null)
    const errMsg = errBody?.error?.message ?? (errBody ? JSON.stringify(errBody) : null)
    logger.warn(`Pass 2: Anthropic API returned ${response.status}${errMsg ? ` — ${errMsg}` : ''} — LLM scan skipped`)
    return []
  }

  const data = await response.json()
  const text = data.content?.[0]?.text ?? '[]'

  try {
    const findings = JSON.parse(text)
    return Array.isArray(findings) ? findings : []
  } catch {
    logger.warn('Pass 2: LLM response was not valid JSON — scan skipped')
    return []
  }
}

/**
 * Pass 3: Prompt string deep scan.
 * Looks for template literals / string concatenations bound to prompt-context
 * variable names or passed to fetch(). Flags any static string segment longer
 * than 8 characters that is not a URL, code keyword, or bare identifier.
 * Never echoes the suspicious value — reports file and line number only.
 * Returns array of { file, line }
 */
function runPromptStringScan(appDir) {
  // Variable declarations whose names suggest prompt/message content
  const PROMPT_VAR_RE = /(?:const|let|var)\s+\w*(?:prompt|system|context|message)\w*\s*=/i
  const FETCH_CALL_RE = /\bfetch\s*\(/

  // Exclusion tests — segments matching these are NOT flagged
  const URL_RE = /https?:\/\//
  // Pure identifier: only word-chars, dots, slashes, hyphens — no whitespace
  const PURE_IDENTIFIER_RE = /^[a-zA-Z0-9_$./\-]+$/
  const JS_KEYWORDS = new Set([
    'function', 'const', 'let', 'var', 'return', 'import', 'export', 'class',
    'if', 'else', 'for', 'while', 'async', 'await', 'true', 'false', 'null',
    'undefined', 'typeof', 'instanceof', 'new', 'this', 'super', 'switch',
    'case', 'break', 'continue', 'throw', 'try', 'catch', 'finally', 'delete',
  ])

  function isSuspicious(segment) {
    const s = segment.replace(/\$\{[^}]*\}/g, '').trim()
    if (s.length <= 8) return false
    if (URL_RE.test(s)) return false
    if (PURE_IDENTIFIER_RE.test(s)) return false
    if (JS_KEYWORDS.has(s)) return false
    return true
  }

  // Extract all static string/template-literal segments from a line
  function extractSegments(line) {
    const segments = []
    // Template literals (handles nested ${} crudely by stopping at first })
    const tplRe = /`([^`]*)`/g
    let m
    while ((m = tplRe.exec(line)) !== null) segments.push(m[1])
    // Single- and double-quoted strings
    const sqRe = /'([^'\\]*)'/g
    while ((m = sqRe.exec(line)) !== null) segments.push(m[1])
    const dqRe = /"([^"\\]*)"/g
    while ((m = dqRe.exec(line)) !== null) segments.push(m[1])
    return segments
  }

  const files = collectFiles(appDir)
  const findings = []

  for (const file of files) {
    let content
    try { content = readFileSync(file, 'utf-8') } catch { continue }
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!PROMPT_VAR_RE.test(line) && !FETCH_CALL_RE.test(line)) continue

      const segments = extractSegments(line)
      if (segments.some(isSuspicious)) {
        findings.push({ file: file.replace(appDir + '/', ''), line: i + 1 })
      }
    }
  }

  return findings
}

/**
 * Run gitleaks on the app directory if available.
 * Returns { ran: bool, passed: bool, output: string }
 */
async function runGitleaks(appDir) {
  if (!(await toolExists('gitleaks'))) {
    return { ran: false, passed: true, output: '' }
  }

  try {
    // --no-git scans working tree without requiring git history
    const { stdout, stderr } = await exec(
      'gitleaks detect --source . --no-git --exit-code 1',
      { cwd: appDir, silent: true }
    )
    return { ran: true, passed: true, output: stdout || stderr }
  } catch (err) {
    return { ran: true, passed: false, output: err.message }
  }
}

export async function runSecurity(cfg, appDir, iface) {
  logger.phase('1.5', 'Security')

  let blocked = false

  // ── Pass 1: personal data string scan ────────────────────────────────────
  logger.step('Pass 1: scanning for personal data flags...')
  const findings = runStringsScan(cfg, appDir)

  if (findings.length > 0) {
    logger.block(`Pass 1 found ${findings.length} personal data flag(s) in committed code`)
    for (const f of findings) {
      logger.error(`  ${f.label} found in ${f.file} (lines: ${f.lines.join(', ')})`)
    }
    logger.raw('')
    logger.raw('  Fix: replace each flagged value with an environment variable.')
    logger.raw('  See skills/personal-data-protection/references/remediation-guide.md')
    blocked = true
  } else {
    logger.success('Pass 1: no personal data flags found')
  }

  // ── Pass 2: LLM judgement ─────────────────────────────────────────────────
  logger.step('Pass 2: LLM privacy audit...')
  const llmFindings = await runLlmScan(cfg, appDir)

  if (llmFindings.length === 0) {
    logger.success('Pass 2: no findings from LLM audit')
  } else {
    const high   = llmFindings.filter(f => f.confidence === 'high')
    const medium = llmFindings.filter(f => f.confidence === 'medium')
    const low    = llmFindings.filter(f => f.confidence === 'low')

    if (high.length > 0) {
      logger.block(`Pass 2: ${high.length} high-confidence finding(s)`)
      for (const f of high) {
        logger.error(`  ${f.file}:${f.line} — ${f.reason}`)
      }
      blocked = true
    }

    for (const f of medium) {
      logger.warn(`Pass 2 [medium] ${f.file}:${f.line} — ${f.reason}`)
      const keep = await confirm('Allow this and continue?', iface)
      if (!keep) {
        logger.error(`  Blocked by user review: ${f.file}:${f.line}`)
        blocked = true
      }
    }

    for (const f of low) {
      logger.info(`Pass 2 [low]    ${f.file}:${f.line} — ${f.reason}`)
    }
  }

  // ── Pass 3: prompt string deep scan ──────────────────────────────────────
  logger.step('Pass 3: prompt string deep scan...')
  const promptFindings = runPromptStringScan(appDir)

  if (promptFindings.length === 0) {
    logger.success('Pass 3: no suspicious string literals in prompt contexts')
  } else {
    logger.block(`Pass 3: ${promptFindings.length} suspicious string literal(s) found in prompt/fetch contexts`)
    for (const f of promptFindings) {
      logger.error(`  ${f.file}:${f.line} — contains a string literal that may be personal data`)
    }
    logger.raw('')
    logger.raw('  Fix: move inline string content to environment variables or config.')
    logger.raw('  See skills/personal-data-protection/references/remediation-guide.md')
    blocked = true
  }

  // ── Gitleaks ──────────────────────────────────────────────────────────────
  logger.step('Running gitleaks...')
  const gl = await runGitleaks(appDir)

  if (!gl.ran) {
    logger.warn('gitleaks not installed — secret scanning skipped')
    logger.info('  Install: https://github.com/gitleaks/gitleaks#install')
  } else if (!gl.passed) {
    logger.block('gitleaks detected potential secrets in the codebase')
    logger.raw(gl.output)
    blocked = true
  } else {
    logger.success('gitleaks: no secrets detected')
  }

  // ── Result ────────────────────────────────────────────────────────────────
  if (blocked) {
    logger.block('Security findings detected — review the issues listed above.')
    logger.raw('  Fix: replace flagged values with environment variables before deploying.')
    logger.raw('  See skills/personal-data-protection/references/remediation-guide.md')
    const proceed = await confirm('Continue bootstrap despite security findings?', iface)
    if (!proceed) throw new Error('Bootstrap aborted by user after security review.')
    logger.warn('Continuing with security findings — resolve before merging to main.')
  }

  logger.success('Phase 1.5 complete — security checks passed')
}
