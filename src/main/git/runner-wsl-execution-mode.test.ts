import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock, execFileSyncMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  spawnMock: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  execFileSync: execFileSyncMock,
  spawn: spawnMock
}))
vi.mock('../observability/instrumentation', () => ({
  withGitSpan: (_attributes: unknown, run: () => unknown) => run()
}))
vi.mock('../diagnostics/main-thread-churn-probe', () => ({ recordSubprocessSpawn: vi.fn() }))

import { gitExecFileAsync } from './runner'
import { resetWslGitReadEnvironmentForTests } from './wsl-git-read-environment'
import { resetWslLinkedWorktreeGitRoutingForTests } from './wsl-linked-worktree-git-routing'

const WSL_CWD = String.raw`\\wsl.localhost\Ubuntu\home\user\repo`

async function withWin32<T>(run: () => Promise<T>): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  try {
    return await run()
  } finally {
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
  }
}

async function argvFor(options: { cwd: string; wslDistro?: string }): Promise<string[]> {
  execFileMock.mockClear()
  await gitExecFileAsync(['rev-parse', '--show-toplevel'], options)
  return execFileMock.mock.calls.at(-1)?.[1] as string[]
}

/**
 * Characterization, not endorsement: these pin what ships today so the shell-mode
 * unification has a parity anchor. The divergence asserted below is the defect --
 * `wslDistro` carries no routing information once the cwd names the distro, yet it
 * still decides whether the user's profile is loaded.
 */
describe('WSL git execution mode (characterization)', () => {
  beforeEach(() => {
    execFileMock.mockReset()
    resetWslGitReadEnvironmentForTests()
    resetWslLinkedWorktreeGitRoutingForTests()
    execFileMock.mockImplementation((_binary, _args, _options, callback) => {
      callback?.(null, '', '')
      return new EventEmitter()
    })
  })

  it('routes to the distro named by the cwd either way', async () => {
    await withWin32(async () => {
      expect((await argvFor({ cwd: WSL_CWD })).slice(0, 2)).toEqual(['-d', 'Ubuntu'])
      expect((await argvFor({ cwd: WSL_CWD, wslDistro: 'Ubuntu' })).slice(0, 2)).toEqual([
        '-d',
        'Ubuntu'
      ])
    })
  })

  it('picks the shell from the hint rather than the host', async () => {
    await withWin32(async () => {
      const withoutHint = await argvFor({ cwd: WSL_CWD })
      const withHint = await argvFor({ cwd: WSL_CWD, wslDistro: 'Ubuntu' })

      // No hint: a bare non-login shell -- no ~/.profile, so no user PATH and no
      // ssh-agent, which is exactly what writes need.
      expect(withoutHint.slice(2, 5)).toEqual(['--exec', 'bash', '-c'])
      expect(withoutHint.at(-1)).not.toContain('getent passwd')

      // Same command, same host, one optional field later: the user's login shell.
      expect(withHint.slice(2, 5)).toEqual(['--exec', 'sh', '-lc'])
      expect(withHint.at(-1)).toContain('getent passwd')

      expect(withoutHint).not.toEqual(withHint)
    })
  })
})
