// Why this module exists: `out/electron-dev` accumulates one ~270MB copy of Electron.app per
// (branch title x Electron version x bundle layout). The runner only ever clears the directory it is
// about to rebuild, so siblings from renamed branches and past upgrades are never reclaimed --
// measured at 143 directories / 38GB across one developer's worktrees.

/**
 * Which cached bundle directories are safe to reclaim.
 *
 * Never returns a directory in use by a running dev instance: deleting a bundle out from under a
 * live Electron process can crash it mid-session, and developers routinely run several at once.
 *
 * `processTable` is raw `ps` output, searched for each candidate rather than parsed into paths.
 * Parsing was tried twice and failed twice in the same dangerous direction -- a regex that missed a
 * live process yielded "nothing is running" and deleted its bundle. Searching for a known absolute
 * directory is immune to spaces and shell-significant characters in the path, and the trailing
 * slash keeps `<dir>2` from being mistaken for `<dir>`.
 */
export function selectStaleDevBundleDirs({ dirs, currentDir, processTable }) {
  return dirs.filter((dir) => dir !== currentDir && !processTable.includes(`${dir}/`))
}
