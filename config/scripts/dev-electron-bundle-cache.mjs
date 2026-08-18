// Why this module exists: `out/electron-dev` accumulates one ~270MB copy of Electron.app per
// (branch title x Electron version x bundle layout). The runner only ever clears the directory it is
// about to rebuild, so siblings from renamed branches and past upgrades are never reclaimed --
// measured at 143 directories / 38GB across one developer's worktrees.

/** Directory holding a bundle is "in use" if a live process path points inside it. */
function isInUse(dir, livePaths) {
  return livePaths.some((livePath) => livePath === dir || livePath.startsWith(`${dir}/`))
}

/**
 * Which cached bundle directories are safe to reclaim.
 *
 * Never returns the directory in use by a running dev instance: deleting a bundle out from under a
 * live Electron process can crash it mid-session, and developers routinely run several at once.
 */
export function selectStaleDevBundleDirs({ dirs, currentDir, livePaths }) {
  return dirs.filter((dir) => dir !== currentDir && !isInUse(dir, livePaths))
}
