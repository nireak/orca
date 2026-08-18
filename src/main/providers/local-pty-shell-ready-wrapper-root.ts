/**
 * On-disk layout of the generated shell-ready wrapper files -- the shared
 * contract between wrapper generation and shell launch.
 *
 * The tree is content-addressed (see shell-ready-wrapper-store.ts) so that this
 * build's wrappers can never be clobbered by another build sharing the same
 * user data dir.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getShellReadyWrapperPaths,
  resolveShellReadyWrapperRoot,
  shellReadyWrappersExistAt
} from '../shell-ready-wrapper-store'
import { buildLocalShellReadyWrapperFiles } from './local-pty-shell-ready-wrapper-fileset'

export { SHELL_READY_MARKER_ESCAPED } from './local-pty-shell-ready-marker'

export function getShellReadyWrapperBaseDir(): string {
  // Why: bundled into the daemon fork (no electron), so read ORCA_USER_DATA_PATH rather than electron's userData; main and the fork both set it to the same path.
  // Why not the legacy `shell-ready/`: daemons of older builds still write that
  // path unconditionally, so this build's trees live out of their reach.
  // Why `||` and not `??`: an empty ORCA_USER_DATA_PATH would leave a relative
  // base dir, and the pruner recursively removes directories under it -- that
  // must never resolve against the process cwd. Matches the daemon resolver.
  const userDataPath = process.env.ORCA_USER_DATA_PATH || tmpdir()
  return join(userDataPath, 'shell-wrappers')
}

// Why memoized: the digest is stable for a given base dir and every shell
// launch asks for it. Why keyed on the base dir rather than a bare flag: it
// self-invalidates if ORCA_USER_DATA_PATH is ever re-pointed mid-process.
let cachedShellReadyWrapperRoot: { baseDir: string; root: string } | null = null

export function getShellReadyWrapperRoot(): string {
  const baseDir = getShellReadyWrapperBaseDir()
  if (cachedShellReadyWrapperRoot?.baseDir !== baseDir) {
    cachedShellReadyWrapperRoot = {
      baseDir,
      root: resolveShellReadyWrapperRoot(baseDir, buildLocalShellReadyWrapperFiles)
    }
  }
  return cachedShellReadyWrapperRoot.root
}

export function getRequiredShellReadyWrapperPaths(root = getShellReadyWrapperRoot()): string[] {
  return getShellReadyWrapperPaths(root, buildLocalShellReadyWrapperFiles)
}

export function shellReadyWrappersExist(root = getShellReadyWrapperRoot()): boolean {
  return shellReadyWrappersExistAt(root, buildLocalShellReadyWrapperFiles)
}
