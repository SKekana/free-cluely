import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { promisify } from "node:util"
import type { SystemAudioSource } from "./contracts"
const exec = promisify(execFile)

export async function linuxMonitorSources(): Promise<SystemAudioSource[]> {
  const { stdout } = await exec("pactl", ["--format=json", "list", "sources"], { timeout: 5000, maxBuffer: 1024 * 1024 })
  const sources = JSON.parse(stdout) as { name: string; description?: string; monitor_of_sink?: number }[]
  return sources.filter(source => source.name !== "auto_null.monitor" &&
    (source.name.endsWith(".monitor") || (typeof source.monitor_of_sink === "number" && source.monitor_of_sink !== 4294967295)))
    .map(source => ({ id: source.name, name: source.description || source.name }))
}
export async function hasLinuxRecorder(): Promise<boolean> {
  try { await exec("parec", ["--version"], { timeout: 3000 }); return true } catch { return false }
}
export class SystemAudioCapture {
  private child?: ChildProcessWithoutNullStreams
  private killTimer?: ReturnType<typeof setTimeout>
  start(source: string, onData: (data: Uint8Array) => void, onError: (message: string) => void): void {
    this.stop()
    const child = spawn("parec", ["--record", "--device", source, "--raw", "--format=s16le", "--rate=16000", "--channels=1", "--latency-msec=100"], { stdio: ["pipe", "pipe", "pipe"] })
    this.child = child
    let remainder = Buffer.alloc(0)
    child.stdout.on("data", (data: Buffer) => {
      if (this.child !== child) return
      const bytes = Buffer.concat([remainder, data]); const evenLength = bytes.length - bytes.length % 2
      remainder = bytes.subarray(evenLength)
      // Bound packet size regardless of how the native stream batches writes.
      for (let offset = 0; offset < evenLength; offset += 3200) onData(bytes.subarray(offset, Math.min(offset + 3200, evenLength)))
    })
    child.stderr.resume() // Drain without logging any raw input or environment details.
    child.on("error", () => { if (this.child === child) { this.child = undefined; onError("System audio could not start. Install pulseaudio-utils and check the selected output device.") } })
    child.on("exit", () => { if (this.child === child) { this.child = undefined; onError("System audio stopped. Check the selected output device and restart Live.") } })
  }
  stop(): void {
    const child = this.child; this.child = undefined
    if (!child) return
    child.stdout.removeAllListeners("data")
    child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 1000)
    this.killTimer = timer; timer.unref()
    child.once("exit", () => { clearTimeout(timer); if (this.killTimer === timer) this.killTimer = undefined })
  }
}
