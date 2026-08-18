/**
 * The wrapper files main's local PTY path launches shells with, addressed
 * relative to their tree root so the tree can be content-addressed (see
 * shell-ready-wrapper-store.ts).
 */
import { join } from 'node:path'
import type { ShellReadyWrapperFile } from '../shell-ready-wrapper-store'
import {
  buildZshStartupWrapperFiles,
  type ZshStartupWrapperSpec
} from '../zsh-startup-wrapper-builder'
import { getBashShellReadyRcfileContent } from './local-pty-shell-ready-bash-rcfile'
import { SHELL_READY_MARKER_ESCAPED } from './local-pty-shell-ready-marker'

export function getLocalZshWrapperSpec(zshDir: string): ZshStartupWrapperSpec {
  return {
    headerLabel: 'Orca zsh shell-ready wrapper',
    zshDir,
    zshenvStrategy: 'discover-user-zdotdir',
    readyMarkerEscaped: SHELL_READY_MARKER_ESCAPED,
    osc133CommandMarkers: true,
    skipUserZshrcWhenHomeIsWrapperDir: true,
    interactiveRestoreComment:
      "# Why: ~/.zshrc can export the user's default OpenCode config after spawn.",
    loginRestoreComment:
      '# Why: .zlogin is the final login startup file before the prompt is shown.',
    restores: {
      agentTeamsPath: true,
      remoteCliBinDir: false,
      codexHome: true,
      codexLaunchPreflight: true
    },
    readyMarkerOrder: 'before-zdotdir-restore',
    legacyFormatting: {
      unindentedMimocodeRestore: true,
      codexHomeRestoreComment:
        "# Why: Codex must keep using Orca's runtime CODEX_HOME after rc files."
    }
  }
}

export function buildLocalShellReadyWrapperFiles(root: string): readonly ShellReadyWrapperFile[] {
  const zsh = buildZshStartupWrapperFiles(getLocalZshWrapperSpec(join(root, 'zsh')))
  return [
    { relativePath: join('zsh', '.zshenv'), content: zsh.zshenv },
    { relativePath: join('zsh', '.zprofile'), content: zsh.zprofile },
    { relativePath: join('zsh', '.zshrc'), content: zsh.zshrc },
    { relativePath: join('zsh', '.zlogin'), content: zsh.zlogin },
    { relativePath: join('bash', 'rcfile'), content: getBashShellReadyRcfileContent() }
  ]
}
