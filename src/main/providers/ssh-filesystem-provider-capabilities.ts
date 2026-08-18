import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'
import { waitForSshCapabilityProbe } from './ssh-capability-probe-waiter'

const quickOpenSearchSupport = new WeakMap<SshChannelMultiplexer, Promise<boolean>>()

export function probeSshQuickOpenSearchCapability(
  mux: SshChannelMultiplexer,
  signal?: AbortSignal
): Promise<boolean> {
  const cached = quickOpenSearchSupport.get(mux)
  let probe = cached
  if (!probe) {
    probe = mux
      .request('fs.getCapabilities', undefined, { timeoutMs: 5_000 })
      .then((result) => {
        const version = (result as { quickOpenSearchVersion?: unknown } | null)
          ?.quickOpenSearchVersion
        return typeof version === 'number' && Number.isInteger(version) && version >= 1
      })
      .catch((error) => {
        if (isMethodNotFoundError(error)) {
          return false
        }
        throw error
      })
      .catch((error) => {
        if (quickOpenSearchSupport.get(mux) === probe) {
          quickOpenSearchSupport.delete(mux)
        }
        throw error
      })
    quickOpenSearchSupport.set(mux, probe)
  }
  return waitForSshCapabilityProbe(probe, signal)
}
