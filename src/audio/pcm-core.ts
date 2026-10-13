// Stateful linear resampling retains fractional positions across worklet blocks.
export class PcmEncoder {
  private buffered = new Float32Array(0)
  private position = 0
  private step: number
  constructor(inputRate: number, outputRate = 16000) {
    if (!Number.isFinite(inputRate) || inputRate <= 0 || outputRate <= 0) throw new Error("Invalid sample rate")
    this.step = inputRate / outputRate
  }
  encode(input: Float32Array): Uint8Array {
    const samples = new Float32Array(this.buffered.length + input.length)
    samples.set(this.buffered); samples.set(input, this.buffered.length)
    const output: number[] = []
    while (this.position + 1 < samples.length) {
      const index = Math.floor(this.position), fraction = this.position - index
      const value = Math.max(-1, Math.min(1, samples[index] * (1 - fraction) + samples[index + 1] * fraction))
      output.push(Math.round(value < 0 ? value * 32768 : value * 32767))
      this.position += this.step
    }
    const consumed = Math.min(Math.floor(this.position), Math.max(0, samples.length - 1))
    this.buffered = samples.slice(consumed); this.position -= consumed
    const bytes = new Uint8Array(output.length * 2), view = new DataView(bytes.buffer)
    output.forEach((value, index) => view.setInt16(index * 2, value, true))
    return bytes
  }
}
