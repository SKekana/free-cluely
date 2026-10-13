export class MediaResources {
  streams: MediaStream[] = []
  contexts: AudioContext[] = []
  nodes: AudioWorkletNode[] = []
  timers: ReturnType<typeof setInterval>[] = []
  addStream(stream: MediaStream): MediaStream { this.streams.push(stream); return stream }
  dispose(): void {
    for (const timer of this.timers) clearInterval(timer)
    for (const node of this.nodes) { node.port.onmessage = null; node.port.close(); node.disconnect() }
    for (const stream of this.streams) for (const track of stream.getTracks()) { track.onended = null; track.stop() }
    for (const context of this.contexts) void context.close().catch(() => {})
    this.streams = []; this.contexts = []; this.nodes = []; this.timers = []
  }
}
export async function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(",")[1])
    reader.onerror = () => reject(new Error("Could not read recorded media"))
    reader.readAsDataURL(blob)
  })
}
