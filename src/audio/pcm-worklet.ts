import { PcmEncoder } from "./pcm-core"
declare const sampleRate: number
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class PcmProcessor extends AudioWorkletProcessor {
  private encoder = new PcmEncoder(sampleRate)
  private pending = new Uint8Array(0)
  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0]
    if (!channels?.length) return true
    const mono = new Float32Array(channels[0].length)
    for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length
    const bytes = this.encoder.encode(mono)
    const combined = new Uint8Array(this.pending.length + bytes.length)
    combined.set(this.pending); combined.set(bytes, this.pending.length)
    let offset = 0
    while (combined.length - offset >= 3200) {
      const packet = combined.slice(offset, offset + 3200)
      this.port.postMessage(packet, [packet.buffer]); offset += 3200
    }
    this.pending = combined.slice(offset)
    return true
  }
}
registerProcessor("wingman-pcm", PcmProcessor)
