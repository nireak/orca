/**
 * Which ConPTY implementation a Windows PTY spawns against.
 *
 * Orca pins node-pty's bundled ConPTY (`useConptyDll`) on every Windows spawn:
 * legacy system ConPTY has no reliable wrap markers and corrupts full-width TUI
 * rows in scrollback (#5921 / PR #6890). That pin also means the bundled
 * OpenConsole build — not the user's Windows version — decides how the console
 * text buffer is turned back into VT, which is where a wide-glyph fault would
 * live (#15192).
 *
 * The env override exists so that variable can be A/B'd on a reporter's machine
 * without shipping a build. It is diagnostic only; the default is unchanged.
 */
export const ORCA_WINDOWS_CONPTY_BACKEND_ENV = 'ORCA_WINDOWS_CONPTY_BACKEND'

export type WindowsConptySpawnOptions = { useConptyDll: true } | Record<string, never>

/** Spawn options selecting the ConPTY backend; `{}` off Windows and for the `system` override. */
export function windowsConptySpawnOptions(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform
): WindowsConptySpawnOptions {
  if (platform !== 'win32') {
    return {}
  }
  return env[ORCA_WINDOWS_CONPTY_BACKEND_ENV]?.trim().toLowerCase() === 'system'
    ? {}
    : { useConptyDll: true }
}
