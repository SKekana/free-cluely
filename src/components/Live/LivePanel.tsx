import { useEffect, useRef, useState } from "react"
import { useCapture } from "../../capture/CaptureContext"
import type { CaptureSource, LiveOptions } from "../../../electron/contracts"

export default function LivePanel() {
  const capture = useCapture()
  const [options, setOptions] = useState<LiveOptions>({ microphone: true, systemAudio: true, screen: true })
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [microphoneId, setMicrophoneId] = useState("")
  const [selectionError, setSelectionError] = useState("")
  const [loadingSources, setLoadingSources] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState("")
  const [showCaptions, setShowCaptions] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(true)
  const suggestionsBox = useRef<HTMLDivElement>(null)
  const followSuggestions = useRef(true)
  useEffect(() => {
    if (followSuggestions.current && suggestionsBox.current) suggestionsBox.current.scrollTop = suggestionsBox.current.scrollHeight
  }, [capture.suggestions])
  const disabled = capture.liveBusy || capture.clipRecording || capture.clipBusy
  async function refresh() {
    setLoadingSources(true); setSelectionError("")
    try {
      await capture.refreshCapabilities()
      const sources = await window.electronAPI.getCaptureSources()
      setSources(sources)
      setOptions(previous => ({ ...previous, sourceId: sources.some(source => source.id === previous.sourceId) ? previous.sourceId : sources[0]?.id }))
      setMicrophones((await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "audioinput"))
    } catch (error) { setSelectionError(error instanceof Error ? error.message : "Could not list sources") }
    finally { setLoadingSources(false) }
  }
  async function testLive() {
    setTesting(true); setTestStatus("")
    try { const result = await window.electronAPI.testLiveConnection(); setTestStatus(result.success ? "Live connection verified" : result.error || "Live test failed") }
    catch (error) { setTestStatus(error instanceof Error ? error.message : "Live test failed") }
    finally { setTesting(false) }
  }
  const systemSource = options.systemSourceId || capture.capabilities?.systemSources[0]?.id
  const selectedSource = sources.find(source => source.id === options.sourceId)
  const needsDisplay = options.screen || (options.systemAudio && capture.capabilities?.platform === "win32")
  const unavailable = !capture.config?.capabilities.live || (options.systemAudio && !capture.capabilities?.systemAudio) ||
    (options.screen && !capture.capabilities?.screen) || (needsDisplay && !selectedSource) || (!options.microphone && !options.systemAudio && !options.screen)
  return <section className="mx-2 mt-3 rounded-xl border border-white/20 bg-black/70 p-3 text-xs text-white shadow-lg" aria-label="Live assistance">
    <div className="flex items-center justify-between gap-3">
      <div><strong>Live assistance</strong><div className="mt-1 text-white/60" role="status">{capture.liveBusy ? `${capture.status} · ${Math.floor(capture.elapsed / 60)}:${String(capture.elapsed % 60).padStart(2, "0")}` : "Silent · continuous suggestions"}</div></div>
      <button type="button" className={`rounded-lg px-3 py-2 ${capture.liveBusy ? "bg-red-600" : "bg-blue-600 disabled:bg-gray-600"}`}
        disabled={!capture.liveBusy && (disabled || unavailable || testing || loadingSources)} onClick={() => { if (capture.liveBusy) void capture.stopLive(); else { setSettingsOpen(false); followSuggestions.current = true; void capture.startLive({ ...options, systemSourceId: systemSource }, microphoneId) } }}>
        {capture.liveBusy ? "Stop Live" : "Start Live"}
      </button>
    </div>
    {!capture.config?.capabilities.live && <p className="mt-2 text-white/70">Configure Gemini in Models to use Live assistance.</p>}
    <details className="mt-3" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-white/70">Capture settings{selectedSource ? ` · ${selectedSource.name}` : ""}</summary>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-3">
          {(["microphone", "systemAudio", "screen"] as const).map(input => <label key={input} className="flex items-center gap-1.5">
            <input type="checkbox" checked={options[input]} disabled={disabled} onChange={event => setOptions(previous => ({ ...previous, [input]: event.target.checked }))} />
            {input === "systemAudio" ? "System audio" : input === "microphone" ? "Microphone" : "Screen"}
          </label>)}
        </div>
        {options.systemAudio && !capture.capabilities?.systemAudio && <p className="text-amber-200">{capture.capabilities?.systemAudioReason || "Checking system audio…"}</p>}
        {options.screen && capture.capabilities && !capture.capabilities.screen && <p className="text-amber-200">Screen capture requires a graphical desktop.</p>}
        <button type="button" disabled={disabled || loadingSources} onClick={() => void refresh()} className="rounded border border-white/30 px-2 py-1 disabled:opacity-50">{loadingSources ? "Loading…" : "Choose screen / refresh devices"}</button>
        {sources.length > 0 && <label className="block">Screen or window<select aria-label="Screen or window" className="mt-1 w-full rounded bg-gray-800 p-2" value={options.sourceId || ""} disabled={disabled} onChange={event => setOptions(previous => ({ ...previous, sourceId: event.target.value }))}>
          {sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select></label>}
        {selectedSource?.thumbnail && !capture.liveBusy && <img alt={`Preview of ${selectedSource.name}`} src={selectedSource.thumbnail} className="max-h-24 rounded" />}
        {microphones.length > 0 && <label className="block">Microphone<select aria-label="Microphone" className="mt-1 w-full rounded bg-gray-800 p-2" value={microphoneId} disabled={disabled} onChange={event => setMicrophoneId(event.target.value)}>
          <option value="">Default microphone</option>{microphones.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
        </select></label>}
        {!!capture.capabilities?.systemSources.length && <label className="block">System output<select aria-label="System output" value={systemSource} disabled={disabled} onChange={event => setOptions(previous => ({ ...previous, systemSourceId: event.target.value }))} className="mt-1 w-full rounded bg-gray-800 p-2">
          {capture.capabilities.systemSources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select></label>}
        <button type="button" disabled={disabled || testing || !capture.config?.capabilities.live} onClick={() => void testLive()} className="rounded border border-white/30 px-2 py-1 disabled:opacity-50">{testing ? "Testing…" : "Test Live connection"}</button>
        {testStatus && <p role="status">{testStatus}</p>}
      </div>
    </details>
    {(capture.error || selectionError) && <p className="mt-2 text-red-200" role="alert">{capture.error || selectionError}</p>}
    {!!capture.suggestions.length && <div ref={suggestionsBox} onScroll={event => { const box = event.currentTarget; followSuggestions.current = box.scrollHeight - box.scrollTop - box.clientHeight < 40 }} className="mt-3 max-h-64 space-y-2 overflow-y-auto" aria-label="Live suggestions" aria-live="polite">
      {capture.suggestions.map(row => <div key={row.id} className={`rounded-lg bg-white/10 p-2 whitespace-pre-wrap ${row.interrupted ? "opacity-60" : ""}`}>{row.text}{row.interrupted && <span className="ml-2 text-white/50">Interrupted</span>}</div>)}
    </div>}
    {!!capture.captions.length && <div className="mt-3"><button type="button" onClick={() => setShowCaptions(value => !value)} className="text-white/60">{showCaptions ? "Hide captions" : "Show captions"}</button>
      {showCaptions && <div className="mt-2 max-h-32 overflow-y-auto text-white/60" aria-label="Live captions">{capture.captions.map(row => <p className="mb-1" key={row.id}>{row.text}</p>)}</div>}
    </div>}
    {capture.usage && <p className="mt-2 text-white/40">Latest usage: {capture.usage.totalTokens.toLocaleString()} tokens</p>}
  </section>
}
