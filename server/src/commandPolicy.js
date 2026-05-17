import { isAbsolute, normalize } from 'node:path'

const SHELL_CONTROL_PATTERNS = [
  { pattern: /&&/, label: 'shell AND operator &&' },
  { pattern: /\|\|/, label: 'shell OR operator ||' },
  { pattern: /;/, label: 'shell command separator ;' },
  { pattern: /`/, label: 'shell backtick substitution' },
  { pattern: /\$\(/, label: 'shell command substitution $(' },
  { pattern: /[<>]/, label: 'shell redirection < or >' },
  { pattern: /[\r\n]/, label: 'newline command injection' }
]

const NODE_EVAL_FLAGS = new Set([
  '-e',
  '--eval',
  '-p',
  '--print',
  '--require',
  '-r',
  '--import'
])

const NPM_BLOCKED_COMMANDS = new Set([
  'exec',
  'x',
  'publish',
  'login',
  'logout',
  'adduser',
  'token',
  'owner',
  'team',
  'profile'
])

const GIT_READ_ONLY_COMMANDS = new Set([
  '',
  'status',
  'diff',
  'log',
  'show',
  'branch',
  'rev-parse',
  'ls-files',
  'grep',
  'describe',
  'remote'
])

const GIT_BLOCKED_COMMANDS = new Set([
  'clean',
  'reset',
  'checkout',
  'restore',
  'switch',
  'rebase',
  'merge',
  'commit',
  'push',
  'pull',
  'fetch',
  'tag',
  'stash',
  'am',
  'apply'
])

function normalizeCommand(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeArgList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '')).filter((item) => item.length > 0)
    : []
}

function hasPathTraversal(value) {
  const normalizedValue = String(value || '').replace(/\\/g, '/')

  return (
    normalizedValue === '..'
    || normalizedValue.startsWith('../')
    || normalizedValue.includes('/../')
    || normalizedValue.endsWith('/..')
  )
}

function looksLikeAbsolutePath(value) {
  const normalizedValue = String(value || '').trim()

  if (!normalizedValue) {
    return false
  }

  if (/^[a-zA-Z]:[\\/]/.test(normalizedValue) || normalizedValue.startsWith('\\\\')) {
    return true
  }

  return isAbsolute(normalize(normalizedValue))
}

function inspectGenericArgs(args) {
  const denials = []

  for (const arg of args) {
    for (const item of SHELL_CONTROL_PATTERNS) {
      if (item.pattern.test(arg)) {
        denials.push(`Argument "${arg}" contains ${item.label}. Pass one command with plain arguments only.`)
      }
    }

    if (looksLikeAbsolutePath(arg)) {
      denials.push(`Argument "${arg}" uses an absolute path. Use paths relative to the workspace.`)
    }

    if (hasPathTraversal(arg)) {
      denials.push(`Argument "${arg}" attempts to leave the workspace with "..".`)
    }
  }

  return denials
}

function inspectNodeArgs(args) {
  const denials = []
  const warnings = []

  for (const arg of args) {
    const normalizedArg = normalizeCommand(arg)

    if (NODE_EVAL_FLAGS.has(normalizedArg) || normalizedArg.startsWith('--eval=')) {
      denials.push(`Node flag "${arg}" is blocked because it executes inline code.`)
    }
  }

  if (!denials.length && args.length) {
    warnings.push('node can execute arbitrary JavaScript from workspace files.')
  }

  return { denials, warnings }
}

function inspectNpmArgs(args) {
  const denials = []
  const warnings = []
  const subcommand = normalizeCommand(args[0])

  if (NPM_BLOCKED_COMMANDS.has(subcommand)) {
    denials.push(`npm ${subcommand} is blocked because it can execute arbitrary packages or change registry/account state.`)
  }

  if (subcommand === 'config' && ['set', 'delete', 'rm'].includes(normalizeCommand(args[1]))) {
    denials.push(`npm config ${args[1]} is blocked because it mutates server npm configuration.`)
  }

  if (['install', 'i', 'ci', 'add'].includes(subcommand)) {
    warnings.push('npm dependency commands can run package lifecycle scripts and modify node_modules or lockfiles.')
  }

  if (subcommand === 'run') {
    warnings.push('npm run executes a project script defined by package.json.')
  }

  return { denials, warnings }
}

function inspectGitArgs(args) {
  const denials = []
  const warnings = []
  const subcommand = normalizeCommand(args[0])

  if (GIT_BLOCKED_COMMANDS.has(subcommand)) {
    denials.push(`git ${subcommand} is blocked because it can mutate history, workspace files, or remote repositories.`)
  }

  if (!GIT_READ_ONLY_COMMANDS.has(subcommand) && !GIT_BLOCKED_COMMANDS.has(subcommand)) {
    warnings.push(`git ${subcommand || '(default)'} is not recognized as a read-only git operation.`)
  }

  return { denials, warnings }
}

export function analyzeCommandPolicy({ command, args } = {}) {
  const normalizedCommand = normalizeCommand(command)
  const normalizedArgs = normalizeArgList(args)
  const denials = inspectGenericArgs(normalizedArgs)
  const warnings = []

  if (normalizedCommand === 'node') {
    const result = inspectNodeArgs(normalizedArgs)
    denials.push(...result.denials)
    warnings.push(...result.warnings)
  } else if (normalizedCommand === 'npm' || normalizedCommand === 'npm.cmd') {
    const result = inspectNpmArgs(normalizedArgs)
    denials.push(...result.denials)
    warnings.push(...result.warnings)
  } else if (normalizedCommand === 'git') {
    const result = inspectGitArgs(normalizedArgs)
    denials.push(...result.denials)
    warnings.push(...result.warnings)
  }

  return {
    allowed: denials.length === 0,
    denials,
    warnings,
    riskLevel: denials.length ? 'blocked' : warnings.length ? 'high' : 'medium'
  }
}
