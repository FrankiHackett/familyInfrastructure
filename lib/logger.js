// lib/logger.js — Coloured phase/step output for the bootstrap agent

const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'
const RED    = '\x1b[31m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BLUE   = '\x1b[34m'
const CYAN   = '\x1b[36m'
const WHITE  = '\x1b[37m'
const BG_BLUE = '\x1b[44m'

export const logger = {
  phase(num, name) {
    const bar = '─'.repeat(56)
    console.log('')
    console.log(`${BOLD}${BG_BLUE}${WHITE}  Phase ${num}: ${name}  ${RESET}`)
    console.log(`${DIM}${bar}${RESET}`)
  },

  step(msg) {
    console.log(`  ${CYAN}→${RESET} ${msg}`)
  },

  success(msg) {
    console.log(`  ${GREEN}✓${RESET} ${msg}`)
  },

  warn(msg) {
    console.log(`  ${YELLOW}⚠${RESET}  ${msg}`)
  },

  error(msg) {
    console.error(`  ${RED}✗${RESET} ${msg}`)
  },

  info(msg) {
    console.log(`  ${DIM}${msg}${RESET}`)
  },

  block(msg) {
    const line = '═'.repeat(60)
    console.error(`\n${RED}${BOLD}${line}${RESET}`)
    console.error(`${RED}${BOLD}  BLOCKED: ${msg}${RESET}`)
    console.error(`${RED}${BOLD}${line}${RESET}\n`)
  },

  summary(lines) {
    const bar = '═'.repeat(60)
    console.log(`\n${GREEN}${BOLD}${bar}${RESET}`)
    console.log(`${GREEN}${BOLD}  Bootstrap Complete${RESET}`)
    console.log(`${GREEN}${BOLD}${bar}${RESET}`)
    for (const [label, value] of lines) {
      const pad = ' '.repeat(Math.max(1, 20 - label.length))
      console.log(`  ${BOLD}${label}${RESET}${pad}${value}`)
    }
    console.log(`${GREEN}${BOLD}${bar}${RESET}\n`)
  },

  raw(msg) {
    console.log(msg)
  },
}
