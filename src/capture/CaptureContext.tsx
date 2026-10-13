import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import type { CaptureCapabilities, LiveEvent, LiveOptions, LiveStatus, LlmConfig } from "../../electron/contracts"
import { LiveCapture } from "./LiveCapture"
import { ClipRecorder } from "./ClipRecorder"

interface Transcript { id: number; text: string; final: boolean; interrupted?: boolean }
interface CaptureState {
  config?: LlmConfig; capabilities?: CaptureCapabilities; status: LiveStatus; error: string
  captions: Transcript[]; suggestions: Transcript[]; elapsed: number; usage?: LiveEvent["usage"]
  clipRecording: boolean; clipBusy: boolean; clipResult?: string; liveBusy: boolean
  startLive(options: LiveOptions, microphoneId?: string): Promise<void>; stopLive(): Promise<void>
  startClip(): Promise<void>; stopClip(): void; refreshCapabilities(): Promise<void>
}
const Context = createContext<CaptureState | null>(null)
export function useCapture(): CaptureState {
  const value = useContext(Context)
  if (!value) throw new Error("CaptureProvider is required")
  return value
}
function upsert(rows: Transcript[], id: number, text: string, final: boolean): Transcript[] {
  const index = rows.findIndex(row => row.id === id)
  if (index < 0) return [...rows, { id, text, final }].slice(-30)
  return rows.map(row => row.id === id ? { ...row, text, final } : row)
}
export function CaptureProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<LlmConfig>()
  const [capabilities, setCapabilities] = useState<CaptureCapabilities>()
  const [status, setStatus] = useState<LiveStatus>("idle")
  const [error, setError] = useState("")
  const [captions, setCaptions] = useState<Transcript[]>([])
  const [suggestions, setSuggestions] = useState<Transcript[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [usage, setUsage] = useState<LiveEvent["usage"]>()
  const [clip, setClip] = useState<{ recording: boolean; busy: boolean; result?: string }>({ recording: false, busy: false })
  const session = useRef("")
  const previousConfig = useRef<LlmConfig>()
  const startedAt = useRef(0)
  const liveCapture = useRef<LiveCapture>()
  const clipRecorder = useRef<ClipRecorder>()
  if (!liveCapture.current) liveCapture.current = new LiveCapture(window.electronAPI, message => { setError(message); setStatus("error") })
  if (!clipRecorder.current) clipRecorder.current = new ClipRecorder(window.electronAPI, setClip)
  const busy = status === "active" || status === "connecting" || status === "reconnecting"
  async function refreshCapabilities() { setCapabilities(await window.electronAPI.getCaptureCapabilities()) }
  useEffect(() => {
    let disposed = false
    const loadConfig = (next: LlmConfig) => {
      if (disposed) return
      const previous = previousConfig.current
      if (previous && (previous.provider !== next.provider || previous.model !== next.model || previous.liveModel !== next.liveModel || previous.revision !== next.revision)) {
        clipRecorder.current?.cancel(); liveCapture.current?.cleanup(); session.current = ""
        setStatus("idle"); setCaptions([]); setSuggestions([]); setError("")
      }
      previousConfig.current = next; setConfig(next)
    }
    void window.electronAPI.getCurrentLlmConfig().then(loadConfig)
    void window.electronAPI.getCaptureCapabilities().then(value => { if (!disposed) setCapabilities(value) }).catch(() => { if (!disposed) setError("Could not detect capture devices") })
    const subscriptions = [
      window.electronAPI.onLlmConfig(loadConfig),
      window.electronAPI.onResetView(() => {
        clipRecorder.current?.cancel(); liveCapture.current?.cleanup(); session.current = ""
        setStatus("idle"); setCaptions([]); setSuggestions([]); setError(""); setElapsed(0); setUsage(undefined)
      }),
      window.electronAPI.onLiveEvent(event => {
        if (event.type === "status" && event.status === "connecting") { session.current = event.sessionId; startedAt.current = Date.now() }
        if (!session.current || event.sessionId !== session.current) return
        if (event.type === "status" && event.status) {
          setStatus(event.status)
          if (event.status === "idle" || event.status === "error") liveCapture.current?.cleanup()
          if (event.status === "idle") session.current = ""
        }
        if (event.type === "error") setError(event.error || "Live failed")
        if (event.type === "caption" && event.text) setCaptions(rows => upsert(rows, event.turnId!, event.text!, !!event.final))
        if (event.type === "suggestion" && event.text) setSuggestions(rows => upsert(rows, event.turnId!, event.text!, !!event.final))
        if (event.type === "interrupted") setSuggestions(rows => rows.map(row => row.id === event.turnId ? { ...row, final: true, interrupted: true } : row))
        if (event.type === "usage") setUsage(event.usage)
      })
    ]
    return () => { disposed = true; subscriptions.forEach(unsubscribe => unsubscribe()); clipRecorder.current?.cancel(); liveCapture.current?.cleanup(); void window.electronAPI.stopLive().catch(() => {}) }
  }, [])
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [busy])
  async function startLive(options: LiveOptions, microphoneId?: string) {
    if (clip.recording || clip.busy || busy || !capabilities) return
    setError(""); setCaptions([]); setSuggestions([]); setElapsed(0); setUsage(undefined)
    startedAt.current = Date.now(); setStatus("connecting")
    try { await liveCapture.current!.start(options, capabilities.platform, microphoneId) }
    catch (failure) { if (!(failure instanceof DOMException && failure.name === "AbortError")) { setError(failure instanceof Error ? failure.message : "Could not start Live"); setStatus("error") } }
  }
  async function stopLive() { session.current = ""; setStatus("idle"); await liveCapture.current!.stop().catch(() => setError("Could not close the Live connection")) }
  async function startClip() { if (!busy && !clip.recording && !clip.busy && config?.capabilities.audio) await clipRecorder.current!.start() }
  return <Context.Provider value={{ config, capabilities, status, error, captions, suggestions, elapsed, usage, liveBusy: busy,
    clipRecording: clip.recording, clipBusy: clip.busy, clipResult: clip.result, startLive, stopLive, startClip,
    stopClip: () => clipRecorder.current!.stop(), refreshCapabilities }}>{children}</Context.Provider>
}
