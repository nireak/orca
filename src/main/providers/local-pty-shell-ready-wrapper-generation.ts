/**
 * Generates the zsh ZDOTDIR tree and bash rcfile Orca launches shells with.
 *
 * Why: the wrappers emit an OSC 777 marker after startup files finish, which the
 * readiness scanner watches for before a startup command is written.
 */
import {
  pruneStaleShellReadyWrapperRoots,
  writeShellReadyWrappers
} from '../shell-ready-wrapper-store'
import { buildZshStartupWrapperFiles } from '../zsh-startup-wrapper-builder'
import {
  buildLocalShellReadyWrapperFiles,
  getLocalZshWrapperSpec
} from './local-pty-shell-ready-wrapper-fileset'
import {
  getShellReadyWrapperBaseDir,
  getShellReadyWrapperRoot,
  shellReadyWrappersExist
} from './local-pty-shell-ready-wrapper-root'

let didEnsureShellReadyWrappers = false

export function getZshShellReadyRcfileContent(): string {
  return buildZshStartupWrapperFiles(getLocalZshWrapperSpec(`${getShellReadyWrapperRoot()}/zsh`))
    .zshrc
}

export function ensureShellReadyWrappersAt(root = getShellReadyWrapperRoot()): void {
  // Why existence-only is safe: the default root is keyed by a hash of the exact
  // bytes we would write, so a tree that is present is a tree this build wrote.
  if (didEnsureShellReadyWrappers && shellReadyWrappersExist(root)) {
    return
  }
  didEnsureShellReadyWrappers = true

  try {
    writeShellReadyWrappers(root, buildLocalShellReadyWrapperFiles)
    // Why guarded: callers may target an explicit root (tests, snapshots); only
    // the managed default owns the base dir and may collect siblings there.
    if (root === getShellReadyWrapperRoot()) {
      pruneStaleShellReadyWrapperRoots(getShellReadyWrapperBaseDir(), root)
    }
  } catch (error) {
    // Why: degrade gracefully — a failed wrapper (read-only FS, perms, disk) just means no ready marker, PTY stays usable.
    const errorMessage =
      error instanceof Error
        ? `${error.message} (${(error as NodeJS.ErrnoException).code || 'unknown'})`
        : String(error)
    console.error(`[shell-ready] Failed to create wrapper files in ${root}: ${errorMessage}`)
    console.error('[shell-ready] Shell will launch without wrapper (no shell-ready marker)')
    // Reset the flag so next attempt will try again
    didEnsureShellReadyWrappers = false
  }
}

export function ensureShellReadyWrappers(): void {
  if (process.platform === 'win32') {
    return
  }
  ensureShellReadyWrappersAt()
}
