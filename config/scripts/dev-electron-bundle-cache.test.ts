import { describe, expect, it } from 'vitest'
import { selectStaleDevBundleDirs } from './dev-electron-bundle-cache.mjs'

const ROOT = '/repo/out/electron-dev'
const A = `${ROOT}/aaaaaaaaaaaa`
const B = `${ROOT}/bbbbbbbbbbbb`
const C = `${ROOT}/cccccccccccc`

/** A `ps -Awwo command=` line for a dev instance running out of `dir`. */
function psLine(dir: string, appName = 'Orca: some-branch') {
  return `${dir}/${appName}.app/Contents/MacOS/Electron --remote-debugging-port=9333`
}

describe('dev-electron-bundle-cache', () => {
  it('reclaims siblings while keeping the current bundle', () => {
    expect(selectStaleDevBundleDirs({ dirs: [A, B, C], currentDir: B, processTable: '' })).toEqual([
      A,
      C
    ])
  })

  it('never reclaims a bundle a live process is running from', () => {
    // Deleting a bundle out from under a live Electron process can crash it mid-session, and
    // developers routinely run several dev instances at once.
    expect(
      selectStaleDevBundleDirs({ dirs: [A, B, C], currentDir: B, processTable: psLine(A) })
    ).toEqual([C])
  })

  it('protects a live bundle whose path contains spaces', () => {
    // Regression: an extraction regex using \S* could not cross a space, so any developer with a
    // space in their checkout path (or in the .app name, which always has one) got "nothing is
    // live" and had the running instance's bundle deleted.
    const spaced = '/Users/me/My Projects/orca/out/electron-dev/aaaaaaaaaaaa'
    const other = '/Users/me/My Projects/orca/out/electron-dev/bbbbbbbbbbbb'
    expect(
      selectStaleDevBundleDirs({
        dirs: [spaced, other],
        currentDir: C,
        processTable: psLine(spaced, 'Orca: my branch')
      })
    ).toEqual([other])
  })

  it('does not treat a sibling as live just because it shares a prefix', () => {
    // Boundary: `<dir>2` being live must not protect `<dir>`. Without the trailing slash in the
    // needle, `A` would be found inside `A2`'s path and wrongly spared.
    const a2 = `${A}2`
    expect(
      selectStaleDevBundleDirs({ dirs: [A, a2], currentDir: C, processTable: psLine(a2) })
    ).toEqual([A])
  })

  it('reclaims nothing when every directory is current or live', () => {
    expect(
      selectStaleDevBundleDirs({ dirs: [A, B], currentDir: A, processTable: psLine(B) })
    ).toEqual([])
    expect(selectStaleDevBundleDirs({ dirs: [], currentDir: A, processTable: '' })).toEqual([])
  })
})
