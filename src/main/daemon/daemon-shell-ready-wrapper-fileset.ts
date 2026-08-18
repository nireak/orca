/**
 * The wrapper files the daemon launches shells with, addressed relative to
 * their tree root so the tree can be content-addressed (see
 * shell-ready-wrapper-store.ts).
 */
import { join } from 'node:path'
import type { ShellReadyWrapperFile } from '../shell-ready-wrapper-store'
import { buildZshStartupWrapperFiles } from '../zsh-startup-wrapper-builder'
import { getDaemonBashShellReadyRcfileContent } from './daemon-bash-shell-ready-rcfile'
import { getDaemonZshWrapperSpec } from './daemon-zsh-shell-ready-wrapper-spec'

export function buildDaemonShellReadyWrapperFiles(root: string): readonly ShellReadyWrapperFile[] {
  const zsh = buildZshStartupWrapperFiles(getDaemonZshWrapperSpec(join(root, 'zsh')))
  return [
    { relativePath: join('zsh', '.zshenv'), content: zsh.zshenv },
    { relativePath: join('zsh', '.zprofile'), content: zsh.zprofile },
    { relativePath: join('zsh', '.zshrc'), content: zsh.zshrc },
    { relativePath: join('zsh', '.zlogin'), content: zsh.zlogin },
    { relativePath: join('bash', 'rcfile'), content: getDaemonBashShellReadyRcfileContent() }
  ]
}
