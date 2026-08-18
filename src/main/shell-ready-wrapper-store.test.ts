import { describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  pruneStaleShellReadyWrapperRoots,
  resolveShellReadyWrapperRoot,
  shellReadyWrappersExistAt,
  writeShellReadyWrappers,
  type ShellReadyWrapperBuilder
} from './shell-ready-wrapper-store'

const DAY_MS = 24 * 60 * 60 * 1000

function builderFor(marker: string): ShellReadyWrapperBuilder {
  // Why the root is embedded: mirrors .zshenv, the one wrapper file that names
  // its own tree. The digest must stay stable despite it.
  return (root) => [
    { relativePath: join('zsh', '.zshrc'), content: `zshrc ${marker} root=${root}` },
    { relativePath: join('bash', 'rcfile'), content: `rcfile ${marker}` }
  ]
}

function makeBase(): string {
  return mkdtempSync(join(tmpdir(), 'orca-wrapper-store-'))
}

describe('resolveShellReadyWrapperRoot', () => {
  it('gives builds with different wrapper contents different trees', () => {
    const base = makeBase()
    const oldContract = resolveShellReadyWrapperRoot(base, builderFor('ORCA_SHELL_READY_MARKER'))
    const newContract = resolveShellReadyWrapperRoot(base, builderFor('ORCA_SHELL_FEATURES'))
    expect(oldContract).not.toEqual(newContract)
  })

  it('is stable for identical contents', () => {
    const base = makeBase()
    expect(resolveShellReadyWrapperRoot(base, builderFor('a'))).toEqual(
      resolveShellReadyWrapperRoot(base, builderFor('a'))
    )
  })

  // Why: eight `*/shell-ready/zsh` globs baked into the wrapper scripts and three
  // TS guards detect a self-referential ZDOTDIR by this exact suffix. Losing it
  // makes a wrapper source itself until zsh hits its recursion limit.
  it('keeps the zsh dir ending in /shell-ready/zsh', () => {
    const root = resolveShellReadyWrapperRoot(makeBase(), builderFor('a'))
    expect(join(root, 'zsh').endsWith('/shell-ready/zsh')).toBe(true)
  })
})

describe('writeShellReadyWrappers', () => {
  it('writes a tree that reports itself present, with no temp files left behind', () => {
    const base = makeBase()
    const build = builderFor('a')
    const root = resolveShellReadyWrapperRoot(base, build)

    expect(shellReadyWrappersExistAt(root, build)).toBe(false)
    writeShellReadyWrappers(root, build)
    expect(shellReadyWrappersExistAt(root, build)).toBe(true)
    expect(readFileSync(join(root, 'bash', 'rcfile'), 'utf8')).toBe('rcfile a')
    expect(readdirSync(join(root, 'bash')).filter((n) => n.includes('.tmp-'))).toEqual([])
  })

  it('lets two contracts coexist instead of clobbering each other', () => {
    const base = makeBase()
    const oldBuild = builderFor('old')
    const newBuild = builderFor('new')
    const oldRoot = resolveShellReadyWrapperRoot(base, oldBuild)
    const newRoot = resolveShellReadyWrapperRoot(base, newBuild)

    writeShellReadyWrappers(oldRoot, oldBuild)
    writeShellReadyWrappers(newRoot, newBuild)

    // The regression: the second writer used to overwrite the first writer's
    // file in place, leaving the first build launching shells it cannot read.
    expect(readFileSync(join(oldRoot, 'bash', 'rcfile'), 'utf8')).toBe('rcfile old')
    expect(readFileSync(join(newRoot, 'bash', 'rcfile'), 'utf8')).toBe('rcfile new')
    expect(shellReadyWrappersExistAt(oldRoot, oldBuild)).toBe(true)
  })
})

describe('pruneStaleShellReadyWrapperRoots', () => {
  it('collects month-old trees but never the one in use', () => {
    const base = makeBase()
    const build = builderFor('a')
    const keepRoot = resolveShellReadyWrapperRoot(base, build)
    writeShellReadyWrappers(keepRoot, build)

    const staleDir = join(base, 'stale-hash')
    mkdirSync(join(staleDir, 'shell-ready'), { recursive: true })
    const longAgo = new Date(Date.now() - 40 * DAY_MS)
    utimesSync(staleDir, longAgo, longAgo)

    pruneStaleShellReadyWrapperRoots(base, keepRoot)

    expect(existsSync(staleDir)).toBe(false)
    expect(shellReadyWrappersExistAt(keepRoot, build)).toBe(true)
  })

  // Why: older builds still write the unversioned `<userData>/shell-ready/` tree
  // and long-lived daemons launch shells from it. The pruner walks a different
  // base dir and must never be able to reach it, however old it looks.
  it('cannot reach the legacy unversioned tree older daemons still depend on', () => {
    const userData = makeBase()
    const legacyZshrc = join(userData, 'shell-ready', 'zsh', '.zshrc')
    mkdirSync(dirname(legacyZshrc), { recursive: true })
    writeFileSync(legacyZshrc, 'tree an older daemon is still launching shells from')
    const ancient = new Date(Date.now() - 400 * DAY_MS)
    utimesSync(join(userData, 'shell-ready'), ancient, ancient)

    const base = join(userData, 'shell-wrappers')
    const build = builderFor('a')
    const keepRoot = resolveShellReadyWrapperRoot(base, build)
    writeShellReadyWrappers(keepRoot, build)

    pruneStaleShellReadyWrapperRoots(base, keepRoot)

    expect(existsSync(legacyZshrc)).toBe(true)
    expect(shellReadyWrappersExistAt(keepRoot, build)).toBe(true)
  })

  it('keeps recently written trees belonging to other live builds', () => {
    const base = makeBase()
    const mine = builderFor('mine')
    const theirs = builderFor('theirs')
    const myRoot = resolveShellReadyWrapperRoot(base, mine)
    const theirRoot = resolveShellReadyWrapperRoot(base, theirs)
    writeShellReadyWrappers(myRoot, mine)
    writeShellReadyWrappers(theirRoot, theirs)

    pruneStaleShellReadyWrapperRoots(base, myRoot)

    expect(shellReadyWrappersExistAt(theirRoot, theirs)).toBe(true)
    expect(existsSync(dirname(theirRoot))).toBe(true)
  })
})
