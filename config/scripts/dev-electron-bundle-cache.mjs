// Why this module exists: `out/electron-dev` accumulates one ~270MB copy of Electron.app per
// (branch title x Electron version x bundle layout). The runner only ever clears the directory it is
// about to rebuild, so siblings from renamed branches and past upgrades are never reclaimed --
// measured at 143 directories / 38GB across one developer's worktrees.

// A bundle takes tens of seconds to copy. Anything marker-less and newer than this is assumed to be
// a build in flight rather than debris; generous because a cold copy on a busy machine is slow.
export const IN_PROGRESS_WINDOW_MS = 15 * 60 * 1000

/**
 * Which cached bundle directories are safe to reclaim.
 *
 * Three things are protected, and every one of them is a directory some other process still needs:
 *
 * - the bundle this run is about to use;
 * - a bundle a live dev instance is running from. Deleting it can crash that instance mid-session,
 *   and developers routinely run several at once;
 * - a bundle still being copied. Between `mkdirSync` and the marker write it exists, has no marker,
 *   and cannot appear in the process table because its instance has not launched yet -- so a
 *   concurrently starting instance would otherwise delete it mid-copy.
 *
 * `processTable` is raw `ps` output, searched for each candidate rather than parsed into paths.
 * Parsing was tried twice and failed twice in the same dangerous direction -- a regex that missed a
 * live process yielded "nothing is running" and deleted its bundle. Searching for a known absolute
 * directory is immune to spaces and shell-significant characters in the path, and the trailing
 * slash keeps `<dir>2` from being mistaken for `<dir>`.
 */
export function selectStaleDevBundleDirs({ bundles, currentDir, processTable, nowMs }) {
  return bundles
    .filter(({ dir, hasMarker, mtimeMs }) => {
      if (dir === currentDir || processTable.includes(`${dir}/`)) {
        return false
      }
      const buildInFlight = !hasMarker && nowMs - mtimeMs < IN_PROGRESS_WINDOW_MS
      return !buildInFlight
    })
    .map(({ dir }) => dir)
}
