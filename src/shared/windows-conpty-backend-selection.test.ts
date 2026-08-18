import { describe, expect, it } from 'vitest'
import {
  ORCA_WINDOWS_CONPTY_BACKEND_ENV,
  windowsConptySpawnOptions
} from './windows-conpty-backend-selection'

describe('windowsConptySpawnOptions', () => {
  it('pins the bundled ConPTY on Windows by default', () => {
    expect(windowsConptySpawnOptions({}, 'win32')).toEqual({ useConptyDll: true })
  })

  it('yields to system ConPTY only for the explicit override', () => {
    expect(
      windowsConptySpawnOptions({ [ORCA_WINDOWS_CONPTY_BACKEND_ENV]: ' System ' }, 'win32')
    ).toEqual({})
    expect(
      windowsConptySpawnOptions({ [ORCA_WINDOWS_CONPTY_BACKEND_ENV]: 'bundled' }, 'win32')
    ).toEqual({ useConptyDll: true })
    // An unrecognised value must not silently drop the wrap-marker fix (#6890).
    expect(
      windowsConptySpawnOptions({ [ORCA_WINDOWS_CONPTY_BACKEND_ENV]: 'yes' }, 'win32')
    ).toEqual({ useConptyDll: true })
  })

  it('never sets a ConPTY option off Windows', () => {
    expect(
      windowsConptySpawnOptions({ [ORCA_WINDOWS_CONPTY_BACKEND_ENV]: 'system' }, 'darwin')
    ).toEqual({})
    expect(windowsConptySpawnOptions({}, 'linux')).toEqual({})
  })
})
