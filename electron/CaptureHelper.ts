import { desktopCapturer, screen, session, type BrowserWindow, type DesktopCapturerSource } from "electron"
import type { CaptureCapabilities, CaptureSource, OverlayMask } from "./contracts"
import { hasLinuxRecorder, linuxMonitorSources } from "./SystemAudioCapture"

export class CaptureHelper {
  private sources = new Map<string, DesktopCapturerSource>()
  private selected?: { id: string; audio: boolean }
  constructor(private window: () => BrowserWindow | null) {}
  install(): void {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const selected = this.selected
      const source = selected && this.sources.get(selected.id)
      if (!source || request.frame !== this.window()?.webContents.mainFrame) { callback({}); return }
      callback({ video: source, ...(selected?.audio && process.platform === "win32" ? { audio: "loopback" } : {}) })
    })
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined
      callback(webContents.id === this.window()?.webContents.id && permission === "media" && (!mediaTypes || mediaTypes.every(type => type === "audio" || type === "video")))
    })
  }
  async capabilities(): Promise<CaptureCapabilities> {
    const platform = process.platform
    const desktop = platform !== "linux" || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
    if (platform === "win32") return { platform, screen: true, systemAudio: true, systemSources: [{ id: "default", name: "Default system output" }] }
    if (platform === "linux") {
      try {
        const [sources, recorder] = await Promise.all([linuxMonitorSources(), hasLinuxRecorder()])
        return { platform, screen: desktop, systemAudio: recorder && sources.length > 0, systemSources: sources,
          systemAudioReason: !recorder ? "Install pulseaudio-utils to capture system audio." : !sources.length ? "No audio output device is available." : undefined }
      } catch { return { platform, screen: desktop, systemAudio: false, systemSources: [], systemAudioReason: "Connect to a PulseAudio or PipeWire audio server and install pulseaudio-utils." } }
    }
    return { platform, screen: true, systemAudio: false, systemSources: [], systemAudioReason: "System-audio capture is supported on Linux and Windows in this version." }
  }
  async list(): Promise<CaptureSource[]> {
    const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 240, height: 135 }, fetchWindowIcons: false })
    this.sources = new Map(sources.filter(source => !source.id.startsWith(`window:${this.window()?.getMediaSourceId().split(":")[1]}:`)).map(source => [source.id, source]))
    return [...this.sources.values()].map(source => {
      const display = screen.getAllDisplays().find(item => String(item.id) === source.display_id)
      return { id: source.id, name: source.name, kind: source.id.startsWith("screen:") ? "screen" : "window", thumbnail: source.thumbnail.toDataURL(), bounds: display?.bounds }
    })
  }
  select(id: string, systemAudio: boolean): void {
    if (!this.sources.has(id)) throw new Error("Select an available screen or window before starting capture.")
    this.selected = { id, audio: systemAudio }
  }
  reset(): void { this.selected = undefined }
  mask(id: string): OverlayMask | null {
    const source = this.sources.get(id)
    const window = this.window()
    if (!source || !window?.isVisible() || !id.startsWith("screen:")) return null
    const display = screen.getAllDisplays().find(item => String(item.id) === source.display_id)
    if (!display) return null
    const bounds = window.getBounds()
    return { x: (bounds.x - display.bounds.x) / display.bounds.width, y: (bounds.y - display.bounds.y) / display.bounds.height,
      width: bounds.width / display.bounds.width, height: bounds.height / display.bounds.height }
  }
}
