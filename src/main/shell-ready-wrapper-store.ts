/**
 * Content-addressed storage for the generated shell-ready wrapper trees.
 *
 * Why: every writer that shares a userData dir -- main's local PTY path, the
 * daemon fork, and the daemons of other builds that outlive the app that
 * spawned them -- used to write one fixed `shell-ready/` tree. Last writer won,
 * and a daemon whose spawn env no longer matched the wrapper on disk never
 * re-read it, because the guard only checked that the files existed. The ready
 * marker then silently stopped firing and every startup command waited out the
 * full readiness timeout. Keying each tree by a hash of its own contents gives
 * every variant its own directory, so writers cannot clobber each other.
 */
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent
} from 'node:fs'
import { dirname, join } from 'node:path'

/** One wrapper file, addressed relative to its tree root (e.g. `zsh/.zshrc`). */
export type ShellReadyWrapperFile = { relativePath: string; content: string }

/** Builds a wrapper set for a tree rooted at `root`. Called once with a
 *  placeholder root to derive the hash, then with the real root to write. */
export type ShellReadyWrapperBuilder = (root: string) => readonly ShellReadyWrapperFile[]

// Why: only .zshenv embeds the tree path, so hashing a build against a fixed
// placeholder keeps the digest stable across machines and user data dirs while
// still covering every difference that matters (marker contract, hook order).
const HASH_PROBE_ROOT = '/__orca_shell_ready_root__'
const ROOT_HASH_LENGTH = 16
// Why the hash sits ABOVE this leaf rather than below it: ZDOTDIR self-reference
// guards -- three in TS and eight `*/shell-ready/zsh` globs baked into the
// wrapper scripts -- match on that exact suffix. Without it a wrapper sources
// itself and zsh dies with "job table full or recursion limit exceeded". Keeping
// `<base>/<hash>/shell-ready/zsh` leaves every one of those guards intact, and
// keeps older builds able to recognize a newer build's dir.
const WRAPPER_ROOT_LEAF = 'shell-ready'
// Why: long enough that a tree in active use by a long-lived daemon is never
// collected, and a daemon that does lose its tree regenerates it on next spawn.
const STALE_ROOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

let tempFileCounter = 0

export function resolveShellReadyWrapperRoot(
  baseDir: string,
  build: ShellReadyWrapperBuilder
): string {
  const digest = createHash('sha256')
  for (const file of build(HASH_PROBE_ROOT)) {
    digest.update(file.relativePath)
    digest.update('\0')
    digest.update(file.content)
    digest.update('\0')
  }
  return join(baseDir, digest.digest('hex').slice(0, ROOT_HASH_LENGTH), WRAPPER_ROOT_LEAF)
}

export function getShellReadyWrapperPaths(root: string, build: ShellReadyWrapperBuilder): string[] {
  return build(root).map((file) => join(root, file.relativePath))
}

export function shellReadyWrappersExistAt(root: string, build: ShellReadyWrapperBuilder): boolean {
  return getShellReadyWrapperPaths(root, build).every((path) => existsSync(path))
}

export function writeShellReadyWrappers(root: string, build: ShellReadyWrapperBuilder): void {
  for (const file of build(root)) {
    const path = join(root, file.relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeWrapperFileAtomically(path, file.content)
  }
}

/** Drops wrapper trees no build has rewritten in a month. Safe because a daemon
 *  still pointing at a collected tree regenerates it on its next spawn. */
export function pruneStaleShellReadyWrapperRoots(
  baseDir: string,
  keepRoot: string,
  now = Date.now()
): void {
  const keepDir = dirname(keepRoot)
  let entries: Dirent[]
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    const candidate = join(baseDir, entry.name)
    if (candidate === keepDir) {
      continue
    }
    try {
      if (now - statSync(candidate).mtimeMs < STALE_ROOT_MAX_AGE_MS) {
        continue
      }
      rmSync(candidate, { recursive: true, force: true })
    } catch {
      // Best effort: a tree we cannot stat or remove is not worth failing a spawn over.
    }
  }
}

// Why: a torn write still satisfies the existence check, so the shell would
// source a truncated wrapper and never reach the line that emits the marker.
function writeWrapperFileAtomically(path: string, content: string): void {
  tempFileCounter += 1
  const tempPath = `${path}.tmp-${process.pid}-${tempFileCounter}`
  try {
    writeFileSync(tempPath, content, 'utf8')
    chmodSync(tempPath, 0o644)
    renameSync(tempPath, path)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}
