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
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  type Dirent
} from 'node:fs'
import { dirname, join } from 'node:path'
import { renameFileWithWindowsRetry } from './codex-accounts/fs-utils'

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
// Why: bounds the pruner's recursive delete to directory names this store could
// itself have produced, so an unrelated directory sharing the base dir is never
// a deletion candidate.
const WRAPPER_ROOT_DIR_PATTERN = /^[0-9a-f]{16}$/
// Why the hash sits ABOVE this leaf rather than below it: ZDOTDIR self-reference
// guards -- three in TS and eight `*/shell-ready/zsh` globs baked into the
// wrapper scripts -- match on that exact suffix. Without it a wrapper sources
// itself and zsh dies with "job table full or recursion limit exceeded". Keeping
// `<base>/<hash>/shell-ready/zsh` leaves every one of those guards intact, and
// keeps older builds able to recognize a newer build's dir.
const WRAPPER_ROOT_LEAF = 'shell-ready'
// Why: far longer than any plausible gap between launches, so a tree in active
// use is never collected (see markShellReadyWrapperRootInUse for the liveness
// stamp this window is measured against).
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

// Why memoized: the existence check runs on every terminal spawn once the tree
// is warm, and building the set to read five constant file names regenerates
// ~29KB of shell templates that are then thrown away. The names do not depend on
// the root, so one probe build per builder is enough.
const relativePathsByBuilder = new WeakMap<ShellReadyWrapperBuilder, readonly string[]>()

function getShellReadyWrapperRelativePaths(build: ShellReadyWrapperBuilder): readonly string[] {
  let relativePaths = relativePathsByBuilder.get(build)
  if (!relativePaths) {
    relativePaths = build(HASH_PROBE_ROOT).map((file) => file.relativePath)
    relativePathsByBuilder.set(build, relativePaths)
  }
  return relativePaths
}

export function getShellReadyWrapperPaths(root: string, build: ShellReadyWrapperBuilder): string[] {
  return getShellReadyWrapperRelativePaths(build).map((relativePath) => join(root, relativePath))
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
  markShellReadyWrapperRootInUse(root)
}

/** Records that this tree is still in use, so a sibling build's pruner leaves it
 *  alone. Callers must invoke this on every launch, not only when writing.
 *
 *  Why it is needed: writes land two levels down (`<hash>/shell-ready/zsh/...`),
 *  and a directory's mtime only moves when its direct children change -- so the
 *  hash dir's mtime is its CREATION time and never advances on rewrite. Without
 *  this, staleness means "created 30 days ago" rather than "unused for 30 days",
 *  and because main and the daemon hash to different trees under one base dir,
 *  each would collect the other's actively-used tree on any month-old install. */
export function markShellReadyWrapperRootInUse(root: string): void {
  const now = new Date()
  try {
    // The hash dir is what the pruner stats, so that is what has to move.
    utimesSync(dirname(root), now, now)
  } catch {
    // Best effort: a tree we cannot stamp is not worth failing a spawn over.
  }
}

/** Drops wrapper trees no build has launched a shell from in a month, per
 *  markShellReadyWrapperRootInUse. Safe because a daemon still pointing at a
 *  collected tree regenerates it on its next spawn. */
export function pruneStaleShellReadyWrapperRoots(
  baseDir: string,
  keepRoot: string,
  now = Date.now()
): void {
  const keepDir = dirname(keepRoot)
  let entries: Dirent[]
  try {
    // Why lstat first: readdir follows a symlinked base dir, which would point
    // the recursive delete below at real directories somewhere else entirely.
    if (lstatSync(baseDir).isSymbolicLink()) {
      return
    }
    entries = readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    // isDirectory() is false for a symlink-to-directory, so entries that point
    // outside the base dir are skipped here rather than followed.
    if (!entry.isDirectory() || !WRAPPER_ROOT_DIR_PATTERN.test(entry.name)) {
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

/** Creates `tempPath` with O_EXCL, clearing a stranded temp file if one blocks it.
 *
 *  Why O_EXCL: the temp name is derived from the pid, so it is predictable, and
 *  a plain write would follow a symlink planted there -- turning an
 *  Orca-authored shell script into an arbitrary-file write at a target of the
 *  attacker's choosing.
 *
 *  Why the retry: a crash between the write and the rename strands a temp file
 *  at that same deterministic name. Once the OS reuses that pid, O_EXCL would
 *  fail on every future attempt, wrappers would never regenerate, and every
 *  terminal would eat the full readiness timeout forever. Unlinking removes a
 *  planted symlink itself rather than its target, so retrying keeps the
 *  guarantee above. */
function writeTempFileExclusively(tempPath: string, content: string): void {
  try {
    writeFileSync(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
    rmSync(tempPath, { force: true, recursive: true })
    writeFileSync(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o644 })
  }
}

// Why: a torn write still satisfies the existence check, so the shell would
// source a truncated wrapper and never reach the line that emits the marker.
function writeWrapperFileAtomically(path: string, content: string): void {
  tempFileCounter += 1
  const tempPath = `${path}.tmp-${process.pid}-${tempFileCounter}`
  try {
    writeTempFileExclusively(tempPath, content)
    // Why chmod anyway: the mode passed to open() is masked by umask.
    chmodSync(tempPath, 0o644)
    // Why the retry wrapper: on Windows an indexer or antivirus can hold the
    // destination open and the rename fails with EPERM/EACCES/EBUSY. The first
    // ensure in every process rewrites an existing tree, so this replaces a live
    // file on the terminal-spawn path.
    renameFileWithWindowsRetry(tempPath, path)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}
