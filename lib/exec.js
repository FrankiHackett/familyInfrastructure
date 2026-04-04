// lib/exec.js — Shell execution helpers

import { exec as _exec, spawn as _spawn } from 'node:child_process'
import { promisify } from 'node:util'

const _execPromise = promisify(_exec)

/**
 * Run a shell command and return { stdout, stderr }.
 * env: additional environment variables (merged with process.env)
 * cwd: working directory
 * Throws with stderr on non-zero exit.
 */
export async function exec(cmd, { cwd = process.cwd(), env = {}, silent = false } = {}) {
  const opts = {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 10 * 1024 * 1024, // 10MB
  }
  try {
    const { stdout, stderr } = await _execPromise(cmd, opts)
    return { stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (err) {
    const msg = err.stderr?.trim() || err.message
    if (!silent) {
      // Show command without any embedded tokens
      const safeCmd = cmd.replace(/:[A-Za-z0-9_-]{20,}@/g, ':***@')
      throw new Error(`Command failed: ${safeCmd}\n${msg}`)
    }
    throw err
  }
}

/**
 * Run a command with live output streamed to stdout/stderr.
 * Used for long-running commands like `npm install` where progress matters.
 */
export function spawn(cmd, args, { cwd = process.cwd(), env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = _spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: false,
    })

    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })

    child.on('error', reject)
  })
}

/**
 * Check whether a CLI tool is available on PATH.
 */
export async function toolExists(name) {
  try {
    await _execPromise(`which ${name}`)
    return true
  } catch {
    return false
  }
}
