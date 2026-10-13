import { describe, it, expect, vi, afterEach } from "vitest"
import { PcmMixer, FrameThrottle } from "../electron/pcm"
import { PcmEncoder } from "../src/audio/pcm-core"
import { MediaResources } from "../src/capture/resources"
import { ClipRecorder } from "../src/capture/ClipRecorder"
import type { ElectronAPI } from "../electron/contracts"
function pcm(values: number[]) { const bytes = new Uint8Array(values.length * 2); const view = new DataView(bytes.buffer); values.forEach((value, i) => view.setInt16(i * 2, value, true)); return bytes }
function samples(bytes: Uint8Array) { const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); return Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true)) }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe("real-time PCM and frames", () => {
  it("mixes two sources with headroom and fills a missing source with silence", () => {
    const mixer = new PcmMixer(["microphone", "system"])
    mixer.push("microphone", pcm([30000, -30000, 1000])); mixer.push("system", pcm([30000, 10000]))
    expect(samples(mixer.take(3)!)).toEqual([30000, -10000, 500])
  })
  it("drops older input on congestion and clears both sources on reconnection", () => {
    const mixer = new PcmMixer(["microphone", "system"])
    mixer.push("system", pcm(Array(16000).fill(1)))
    expect(mixer.bufferedSamples("system")).toBe(8000)
    mixer.push("system", pcm(Array(8000).fill(2)))
    expect(samples(mixer.take(1)!)).toEqual([1]) // 2 / two enabled inputs
    mixer.clear(); expect(mixer.bufferedSamples("system")).toBe(0)
  })
  it("retains resampling state across irregular input blocks", () => {
    const encoder = new PcmEncoder(48000)
    const input = Float32Array.from({ length: 48001 }, (_, i) => Math.sin(i / 100))
    const chunked: number[] = []
    for (let start = 0; start < input.length; start += 127) chunked.push(...samples(encoder.encode(input.slice(start, start + 127))))
    const whole = samples(new PcmEncoder(48000).encode(input))
    expect(chunked).toEqual(whole); expect(whole.length).toBe(16000)
  })
  it("uses the latest frame and never exceeds one frame per second", () => {
    const throttle = new FrameThrottle()
    throttle.push("first"); expect(throttle.take(0)).toBe("first")
    throttle.push("old"); throttle.push("latest"); expect(throttle.take(999)).toBeUndefined()
    expect(throttle.take(1000)).toBe("latest"); expect(throttle.take(2000)).toBeUndefined()
  })
})
describe("device cleanup", () => {
  it("stops every track, closes contexts and disconnects worklets", () => {
    const resources = new MediaResources(), stop = vi.fn(), close = vi.fn(async () => {}), disconnect = vi.fn(), portClose = vi.fn()
    resources.addStream({ getTracks: () => [{ stop, onended: () => {} }, { stop, onended: () => {} }] } as unknown as MediaStream)
    resources.contexts.push({ close } as unknown as AudioContext)
    resources.nodes.push({ port: { close: portClose, onmessage: () => {} }, disconnect } as unknown as AudioWorkletNode)
    resources.dispose(); resources.dispose()
    expect(stop).toHaveBeenCalledTimes(2); expect(close).toHaveBeenCalledTimes(1); expect(disconnect).toHaveBeenCalledTimes(1); expect(portClose).toHaveBeenCalledTimes(1)
  })
  it("releases a microphone granted after a canceled permission request", async () => {
    let resolve!: (stream: MediaStream) => void
    const stop = vi.fn(), analyze = vi.fn()
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise<MediaStream>(done => { resolve = done }) } })
    const recorder = new ClipRecorder({ analyzeAudioFromBase64: analyze } as unknown as ElectronAPI, () => {})
    const starting = recorder.start(); recorder.cancel()
    resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await starting
    expect(stop).toHaveBeenCalledOnce(); expect(analyze).not.toHaveBeenCalled()
  })
})
