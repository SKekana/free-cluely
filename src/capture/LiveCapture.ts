import workletUrl from "../audio/pcm-worklet.ts?worker&url"
import type { ElectronAPI, LiveOptions } from "../../electron/contracts"
import { blobBase64, MediaResources } from "./resources"

export class LiveCapture {
  private resources = new MediaResources()
  private epoch = 0
  private sessionId = ""
  private video?: HTMLVideoElement
  constructor(private api: ElectronAPI, private onError: (error: string) => void) {}
  cleanup(): void {
    this.epoch++; this.sessionId = ""; this.resources.dispose()
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video = undefined }
  }
  async stop(): Promise<void> { this.cleanup(); await this.api.stopLive() }
  private own(stream: MediaStream, epoch: number): MediaStream {
    if (epoch !== this.epoch) { stream.getTracks().forEach(track => track.stop()); throw new DOMException("Capture canceled", "AbortError") }
    this.resources.addStream(stream)
    for (const track of stream.getTracks()) track.onended = () => {
      if (epoch === this.epoch) { this.onError("A capture device disconnected or screen sharing ended. Restart Live to continue."); void this.stop() }
    }
    return stream
  }
  async start(options: LiveOptions, platform: string, microphoneId?: string): Promise<void> {
    this.cleanup(); const epoch = this.epoch
    const check = () => { if (epoch !== this.epoch) throw new DOMException("Capture canceled", "AbortError") }
    const needsDisplay = options.screen || (options.systemAudio && platform === "win32")
    if (needsDisplay) { await this.api.selectCaptureSource(options.sourceId || "", options.systemAudio); check() }
    // Request both streams in the same user gesture, rather than after a permission prompt.
    const displayPromise = needsDisplay ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: options.systemAudio && platform === "win32" }).then(stream => this.own(stream, epoch)) : Promise.resolve(undefined)
    const microphonePromise = options.microphone ? navigator.mediaDevices.getUserMedia({ audio: { ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}), echoCancellation: true, noiseSuppression: true } }).then(stream => this.own(stream, epoch)) : Promise.resolve(undefined)
    try {
      const [display, microphone] = await Promise.all([displayPromise, microphonePromise]); check()
      if (options.systemAudio && platform === "win32" && !display?.getAudioTracks().length) throw new Error("Windows did not provide a system-audio stream. Check screen-sharing permissions.")
      const { sessionId } = await this.api.startLive(options); check(); this.sessionId = sessionId
      if (microphone || (display?.getAudioTracks().length && options.systemAudio)) {
        const context = new AudioContext(); this.resources.contexts.push(context)
        await context.audioWorklet.addModule(workletUrl); check()
        const attach = (stream: MediaStream, source: "microphone" | "system") => {
          const node = new AudioWorkletNode(context, "wingman-pcm")
          this.resources.nodes.push(node)
          node.port.onmessage = (event: MessageEvent<Uint8Array>) => { if (epoch === this.epoch && this.sessionId) this.api.sendLiveAudio({ sessionId, source, data: event.data }) }
          const gain = context.createGain(); gain.gain.value = 0
          context.createMediaStreamSource(stream).connect(node).connect(gain).connect(context.destination)
        }
        if (microphone) attach(microphone, "microphone")
        if (display?.getAudioTracks().length && options.systemAudio) attach(new MediaStream(display.getAudioTracks()), "system")
        await context.resume(); check()
      }
      if (options.screen && display) {
        const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.srcObject = display; this.video = video
        await video.play(); check()
        const canvas = document.createElement("canvas")
        let busy = false
        const sendFrame = async () => {
          if (busy || epoch !== this.epoch || !video.videoWidth) return
          busy = true
          try {
            const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale)
            const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Screen capture is unavailable")
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const mask = await this.api.getOverlayMask(options.sourceId!); check()
            if (mask) { ctx.fillStyle = "black"; ctx.fillRect(mask.x * canvas.width, mask.y * canvas.height, mask.width * canvas.width, mask.height * canvas.height) }
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.75))
            if (blob) { const data = await blobBase64(blob); check(); this.api.sendLiveFrame({ sessionId, data }) }
          } catch (error) { if (epoch === this.epoch) { this.onError(error instanceof Error ? error.message : "Screen capture failed"); void this.stop() } }
          finally { busy = false }
        }
        void sendFrame(); this.resources.timers.push(setInterval(() => void sendFrame(), 1000))
      }
    } catch (error) {
      if (epoch !== this.epoch) throw new DOMException("Capture canceled", "AbortError")
      this.cleanup(); await this.api.stopLive().catch(() => {})
      throw error
    }
  }
}
