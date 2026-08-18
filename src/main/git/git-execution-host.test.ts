import { describe, expect, it } from 'vitest'
import { gitExecutionHostForTarget, gitExecutionHostKey } from './git-execution-host'

const UNC_UBUNTU = String.raw`\\wsl.localhost\Ubuntu\home\user\repo`
const UNC_DOLLAR_DEBIAN = String.raw`\\wsl$\Debian\home\user\repo`

const keyFor = (target: Parameters<typeof gitExecutionHostForTarget>[0]): string =>
  gitExecutionHostKey(gitExecutionHostForTarget(target))

describe('gitExecutionHostForTarget', () => {
  it('reads the distro out of either WSL UNC spelling', () => {
    expect(gitExecutionHostForTarget({ cwd: UNC_UBUNTU })).toEqual({
      kind: 'wsl',
      distro: 'Ubuntu'
    })
    expect(gitExecutionHostForTarget({ cwd: UNC_DOLLAR_DEBIAN })).toEqual({
      kind: 'wsl',
      distro: 'Debian'
    })
  })

  it('treats a plain path as native', () => {
    expect(gitExecutionHostForTarget({ cwd: String.raw`C:\repo` })).toEqual({ kind: 'native' })
    expect(gitExecutionHostForTarget({ cwd: '/home/user/repo' })).toEqual({ kind: 'native' })
    expect(gitExecutionHostForTarget({})).toEqual({ kind: 'native' })
  })

  it('applies the hint only when the cwd cannot name a distro', () => {
    expect(gitExecutionHostForTarget({ wslDistro: 'Ubuntu' })).toEqual({
      kind: 'wsl',
      distro: 'Ubuntu'
    })
    expect(gitExecutionHostForTarget({ cwd: String.raw`C:\repo`, wslDistro: 'Ubuntu' })).toEqual({
      kind: 'wsl',
      distro: 'Ubuntu'
    })
  })

  // The precedence that matters: git runs where the cwd points, so a hint naming
  // a different distro must not rename the host.
  it('lets the cwd win over a hint that names a different distro', () => {
    expect(gitExecutionHostForTarget({ cwd: UNC_UBUNTU, wslDistro: 'Debian' })).toEqual({
      kind: 'wsl',
      distro: 'Ubuntu'
    })
  })

  it('keys native hosts together and each distro apart', () => {
    expect(keyFor({ cwd: '/repo-a' })).toBe(keyFor({ cwd: '/repo-b' }))
    expect(keyFor({ cwd: UNC_UBUNTU })).toBe(keyFor({ wslDistro: 'Ubuntu' }))
    expect(keyFor({ wslDistro: 'Ubuntu' })).not.toBe(keyFor({ wslDistro: 'Debian' }))
    expect(keyFor({})).not.toBe(keyFor({ wslDistro: 'Ubuntu' }))
  })
})
