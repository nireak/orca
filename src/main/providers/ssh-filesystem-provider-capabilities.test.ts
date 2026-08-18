import { describe, expect, it, vi } from 'vitest'
import { probeSshQuickOpenSearchCapability } from './ssh-filesystem-provider-capabilities'
import { JsonRpcErrorCode } from '../ssh/relay-protocol'

describe('SSH Quick Open capability probe', () => {
  it('recognizes the query-aware relay', async () => {
    const mux = { request: vi.fn().mockResolvedValue({ quickOpenSearchVersion: 1 }) }
    await expect(probeSshQuickOpenSearchCapability(mux as never)).resolves.toBe(true)
    await expect(probeSshQuickOpenSearchCapability(mux as never)).resolves.toBe(true)
    expect(mux.request).toHaveBeenCalledTimes(1)
    expect(mux.request).toHaveBeenCalledWith('fs.getCapabilities', undefined, {
      timeoutMs: 5_000
    })
  })

  it('accepts future compatible capability versions', async () => {
    const mux = { request: vi.fn().mockResolvedValue({ quickOpenSearchVersion: 2 }) }

    await expect(probeSshQuickOpenSearchCapability(mux as never)).resolves.toBe(true)
  })

  it('lets callers treat a missing capability as legacy', async () => {
    const mux = {
      request: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('method not found'), { code: JsonRpcErrorCode.MethodNotFound })
        )
    }
    await expect(probeSshQuickOpenSearchCapability(mux as never)).resolves.toBe(false)
    await expect(probeSshQuickOpenSearchCapability(mux as never)).resolves.toBe(false)
    expect(mux.request).toHaveBeenCalledTimes(1)
  })

  it('does not downgrade transport failures to legacy behavior', async () => {
    const mux = { request: vi.fn().mockRejectedValue(new Error('connection closed')) }
    await expect(probeSshQuickOpenSearchCapability(mux as never)).rejects.toThrow(
      'connection closed'
    )
  })

  it('retries after a shared probe rejects after its caller cancels', async () => {
    let rejectProbe: (error: Error) => void = () => undefined
    const pendingProbe = new Promise((_, reject) => {
      rejectProbe = reject
    })
    const mux = {
      request: vi
        .fn()
        .mockReturnValueOnce(pendingProbe)
        .mockResolvedValueOnce({ quickOpenSearchVersion: 1 })
    }
    const controller = new AbortController()
    const cancelled = probeSshQuickOpenSearchCapability(mux as never, controller.signal)

    controller.abort()
    await expect(cancelled).rejects.toThrow('client_disconnected')
    rejectProbe(new Error('probe timed out'))
    await expect(pendingProbe).rejects.toThrow('probe timed out')
    await new Promise((resolve) => setTimeout(resolve, 0))

    await expect(probeSshQuickOpenSearchCapability(mux as never)).resolves.toBe(true)
    expect(mux.request).toHaveBeenCalledTimes(2)
  })
})
