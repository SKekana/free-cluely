import { describe, it, expect, vi, afterEach } from "vitest"
import type { GoogleGenAI, LiveServerMessage } from "@google/genai"
import { LiveHelper } from "../electron/LiveHelper"
import { LLMHelper } from "../electron/LLMHelper"
import type { LiveEvent } from "../electron/contracts"
function fixture() {
  const events: LiveEvent[] = [], requests: any[] = []
  let callbacks: any
  const sendRealtimeInput = vi.fn(), close = vi.fn()
  const session = { sendRealtimeInput, close, conn: { ws: { bufferedAmount: 0 } } }
  const client = { live: { connect: vi.fn(async request => { requests.push(request); callbacks = request.callbacks; const current = callbacks; queueMicrotask(() => current.onmessage({ setupComplete: {} })); return session }) } } as unknown as GoogleGenAI
  const llm = new LLMHelper("test-key", false, undefined, undefined, async () => client)
  const live = new LiveHelper(llm, event => events.push(event))
  return { live, client, events, requests, session, sendRealtimeInput, message: (message: LiveServerMessage) => callbacks.onmessage(message), closed: (code: number, reason: string) => callbacks.onclose({ code, reason }) }
}
afterEach(() => vi.useRealTimers())
describe("silent Live sessions", () => {
  it("uses native AUDIO with both transcripts and omits obsolete flags", async () => {
    const f = fixture(); await f.live.start()
    expect(f.requests[0].config).toMatchObject({ responseModalities: ["AUDIO"], inputAudioTranscription: {}, outputAudioTranscription: {}, contextWindowCompression: { slidingWindow: {} } })
    expect(f.requests[0].config.enableAffectiveDialog).toBeUndefined()
    expect(f.requests[0].config.thinkingConfig).toBeUndefined()
    f.live.stop()
  })
  it("renders transcript turns, ignores audio parts and marks interruption", async () => {
    const f = fixture(); await f.live.start()
    f.message({ serverContent: { inputTranscription: { text: "Question", finished: true }, outputTranscription: { text: "Suggestion" }, modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm", data: "ignored" } }] } } })
    f.message({ serverContent: { interrupted: true, turnComplete: true } })
    expect(f.events.filter(event => event.type === "caption" && event.final)).toHaveLength(1)
    expect(f.events.some(event => event.type === "suggestion" && event.text === "Suggestion")).toBe(true)
    expect(f.events.some(event => event.type === "interrupted")).toBe(true)
    expect(f.events.some(event => JSON.stringify(event).includes("ignored"))).toBe(false)
    f.live.stop()
  })
  it("resumes after GoAway, discards disconnected input and ignores old events", async () => {
    const f = fixture(); await f.live.start(); vi.useFakeTimers()
    const id = f.live.sessionId
    f.message({ sessionResumptionUpdate: { resumable: true, newHandle: "resume-handle" } })
    f.message({ goAway: { timeLeft: "10s" } })
    f.live.sendAudio(new Uint8Array(3200)); f.live.sendFrame("AAAA")
    expect(f.sendRealtimeInput).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.requests[1].config.sessionResumption.handle).toBe("resume-handle")
    expect(f.live.sessionId).toBe(id); expect(f.live.state).toBe("active")
    f.requests[0].callbacks.onmessage({ serverContent: { outputTranscription: { text: "stale" } } })
    expect(f.events.some(event => event.text === "stale")).toBe(false)
    f.live.stop()
  })
  it("stops rather than repeatedly retrying quota or authorization failures", async () => {
    const f = fixture(); await f.live.start(); vi.useFakeTimers()
    f.closed(1008, "RESOURCE_EXHAUSTED quota")
    await vi.advanceTimersByTimeAsync(20000)
    expect(f.live.state).toBe("error"); expect(f.requests).toHaveLength(1)
    f.live.stop()
  })
  it("restarts an errored session without emitting a stale idle event", async () => {
    const f = fixture(); await f.live.start()
    f.closed(1008, "quota")
    const before = f.events.length
    await f.live.start()
    expect(f.events.slice(before).some(event => event.status === "idle")).toBe(false)
    expect(f.live.state).toBe("active")
    f.live.stop()
  })
  it("a canceled SDK connection cannot close a replacement session", async () => {
    const f = fixture()
    let release!: (session: any) => void
    const connect = vi.mocked(f.client.live.connect)
    connect.mockImplementationOnce(async request => { f.requests.push(request); return new Promise(resolve => { release = resolve }) })
    const canceled = f.live.start().catch(error => error)
    while (!release) await new Promise(resolve => setTimeout(resolve, 0))
    f.live.stop()
    await f.live.start()
    expect((await canceled).name).toBe("AbortError")
    const close = vi.fn()
    release({ ...f.session, close })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(close).toHaveBeenCalled(); expect(f.live.state).toBe("active")
    f.live.stop()
  })
  it("stops sending when the SDK socket is congested", async () => {
    const f = fixture(); await f.live.start()
    f.session.conn.ws.bufferedAmount = 1024 * 1024
    f.live.sendAudio(new Uint8Array(3200))
    expect(f.sendRealtimeInput).not.toHaveBeenCalled()
    f.live.stop()
  })
})
