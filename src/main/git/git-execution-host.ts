import { parseWslUncPath } from '../../shared/wsl-paths'

/**
 * The host that actually runs git for a call.
 *
 * Why: three call sites derived this independently and two of them disagreed on
 * precedence -- the runner routes by cwd, while capability state preferred the
 * caller's `wslDistro` hint. A hint naming a different distro than the cwd then
 * filed capability results against a host that never ran the command.
 *
 * Routing follows the cwd, so identity does too: a WSL UNC cwd names the distro
 * that will run git, and the hint only applies when the cwd cannot name one.
 */

export type GitExecutionHost = { kind: 'native' } | { kind: 'wsl'; distro: string }

export type GitExecutionHostTarget = {
  cwd?: string
  wslDistro?: string
}

/**
 * Platform-agnostic: this reports the host a target *names*. Callers that only
 * route on Windows apply that gate themselves, so a WSL-shaped target keeps one
 * identity across platforms and unit tests do not depend on the host OS.
 */
export function gitExecutionHostForTarget(target: GitExecutionHostTarget): GitExecutionHost {
  const distro = (target.cwd ? parseWslUncPath(target.cwd)?.distro : undefined) ?? target.wslDistro
  return distro ? { kind: 'wsl', distro } : { kind: 'native' }
}

export function gitExecutionHostKey(host: GitExecutionHost): string {
  return host.kind === 'wsl' ? `wsl:${host.distro}` : 'local'
}
