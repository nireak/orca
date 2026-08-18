import { describe, expect, it } from 'vitest'
import { selectStaleDevBundleDirs } from './dev-electron-bundle-cache.mjs'

const ROOT = '/repo/out/electron-dev'
const A = `${ROOT}/aaaaaaaaaaaa`
const B = `${ROOT}/bbbbbbbbbbbb`
const C = `${ROOT}/cccccccccccc`

describe('dev-electron-bundle-cache', () => {
  it('reclaims siblings while keeping the current bundle', () => {
    expect(selectStaleDevBundleDirs({ dirs: [A, B, C], currentDir: B, livePaths: [] })).toEqual([
      A,
      C
    ])
  })

  it('never reclaims a bundle a live process is running from', () => {
    // Deleting a bundle out from under a live Electron process can crash it mid-session, and
    // developers routinely run several dev instances at once.
    const livePaths = [`${A}/Orca: some-branch.app/Contents/MacOS/Electron`]
    expect(selectStaleDevBundleDirs({ dirs: [A, B, C], currentDir: B, livePaths })).toEqual([C])
  })

  it('matches on a path boundary, not a bare prefix', () => {
    // `${ROOT}/aaaaaaaaaaaa2` must not be treated as in use just because it starts with A.
    const sibling = `${A}2`
    const livePaths = [`${A}/x.app/Contents/MacOS/Electron`]
    expect(selectStaleDevBundleDirs({ dirs: [A, sibling], currentDir: C, livePaths })).toEqual([
      sibling
    ])
  })

  it('reclaims nothing when every directory is current or live', () => {
    expect(
      selectStaleDevBundleDirs({ dirs: [A, B], currentDir: A, livePaths: [`${B}/x`] })
    ).toEqual([])
    expect(selectStaleDevBundleDirs({ dirs: [], currentDir: A, livePaths: [] })).toEqual([])
  })
})
