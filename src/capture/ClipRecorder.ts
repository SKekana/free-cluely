import { MAX_CLIP_BYTES, MAX_CLIP_SECONDS } from "../../electron/contracts"
import type { ElectronAPI } from "../../electron/contracts"
import { blobBase64 } from "./resources"

export class ClipRecorder {
  private recorder?: MediaRecorder
  private stream?: MediaStream
  private timer?: ReturnType<typeof setTimeout>
  private epoch = 0
  constructor(private api: ElectronAPI, private update: (state: { recording: boolean; busy: boolean; result?: string }) => void) {}
  cancel(): void {
    this.epoch++; clearTimeout(this.timer)
    const recorder = this.recorder; this.recorder = undefined
    if (recorder) { recorder.onstop = null; recorder.ondataavailable = null; recorder.onerror = null; if (recorder.state !== "inactive") recorder.stop() }
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop() }); this.stream = undefined
    this.update({ recording: false, busy: false })
  }
  stop(): void { if (this.recorder?.state === "recording") this.recorder.stop() }
  async start(): Promise<void> {
    this.cancel(); const epoch = this.epoch
    this.update({ recording: false, busy: true })
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); return }
      this.stream = stream
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error("No supported audio recording format is available")
      const recorder = new MediaRecorder(stream, { mimeType }); this.recorder = recorder
      const chunks: Blob[] = []; let bytes = 0; let tooLarge = false
      recorder.ondataavailable = event => {
        bytes += event.data.size
        if (bytes > MAX_CLIP_BYTES) { tooLarge = true; this.stop() } else chunks.push(event.data)
      }
      recorder.onerror = () => { if (epoch !== this.epoch) return; this.cancel(); this.update({ recording: false, busy: false, result: "Microphone recording failed. Try again." }) }
      stream.getTracks().forEach(track => { track.onended = () => this.stop() })
      recorder.onstop = async () => {
        clearTimeout(this.timer); stream.getTracks().forEach(track => { track.onended = null; track.stop() }); this.stream = undefined; this.recorder = undefined
        if (epoch !== this.epoch) return
        this.update({ recording: false, busy: true })
        try {
          if (tooLarge) throw new Error("The clip exceeded 10 MB. Record a shorter clip.")
          const data = await blobBase64(new Blob(chunks, { type: mimeType }))
          if (epoch !== this.epoch) return
          const result = await this.api.analyzeAudioFromBase64(data, mimeType)
          if (epoch === this.epoch) this.update({ recording: false, busy: false, result: result.text })
        } catch (error) { if (epoch === this.epoch) this.update({ recording: false, busy: false, result: error instanceof Error ? error.message : "Audio analysis failed" }) }
      }
      recorder.start(500); this.timer = setTimeout(() => this.stop(), MAX_CLIP_SECONDS * 1000)
      this.update({ recording: true, busy: false })
    } catch (error) { if (epoch === this.epoch) { this.cancel(); this.update({ recording: false, busy: false, result: error instanceof Error ? error.message : "Could not access the microphone" }) } }
  }
}
