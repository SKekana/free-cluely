export type AudioSource = "microphone" | "system"
const RATE = 16000
// At most half a second per input. On congestion, preserve recent audio.
export class PcmMixer {
  private buffers: Record<AudioSource, Int16Array> = { microphone: new Int16Array(), system: new Int16Array() }
  constructor(private enabled: AudioSource[]) {}
  push(source: AudioSource, data: Uint8Array): void {
    if (!this.enabled.includes(source) || data.byteLength % 2 || data.byteLength > RATE * 2) return
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const samples = new Int16Array(data.byteLength / 2)
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true)
    const previous = this.buffers[source]
    const joined = new Int16Array(previous.length + samples.length)
    joined.set(previous); joined.set(samples, previous.length)
    this.buffers[source] = joined.slice(-RATE / 2)
  }
  take(samples = RATE / 10): Uint8Array | null {
    if (!this.enabled.length) return null
    const output = new Uint8Array(samples * 2)
    const view = new DataView(output.buffer)
    for (let i = 0; i < samples; i++) {
      let mixed = 0
      for (const source of this.enabled) mixed += this.buffers[source][i] || 0
      view.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(mixed / this.enabled.length))), true)
    }
    for (const source of this.enabled) this.buffers[source] = this.buffers[source].slice(samples)
    return output
  }
  clear(): void { this.buffers.microphone = new Int16Array(); this.buffers.system = new Int16Array() }
  bufferedSamples(source: AudioSource): number { return this.buffers[source].length }
}
export class FrameThrottle {
  private lastSent = -Infinity
  private pending?: string
  push(data: string): void { this.pending = data }
  take(now: number): string | undefined {
    if (this.pending === undefined || now - this.lastSent < 1000) return
    const frame = this.pending; this.pending = undefined; this.lastSent = now; return frame
  }
  clear(): void { this.pending = undefined; this.lastSent = -Infinity }
}
