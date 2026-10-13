import { beforeAll, afterAll, describe, it, expect } from "vitest"
import dotenv from "dotenv"
import sharp from "sharp"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"
import { LLMHelper } from "../electron/LLMHelper"
import { LiveHelper } from "../electron/LiveHelper"
import type { LiveEvent } from "../electron/contracts"

dotenv.config({ quiet: true })
// These opt-in checks always use the two models requested for this implementation.
process.env.GEMINI_MODEL = "gemini-3.5-flash-lite"
process.env.GEMINI_LIVE_MODEL = "gemini-3.8-live"
if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY in .env before running authenticated smoke tests")
const llm = new LLMHelper(process.env.GEMINI_API_KEY)
let directory: string, pcm: Buffer, jpeg: Buffer, automaticPcm: Buffer
function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
async function waitFor(predicate: () => boolean, events: LiveEvent[], timeout = 25000) {
  const start = Date.now()
  while (!predicate()) {
    const error = events.find(event => event.type === "error")
    if (error) throw new Error(error.error)
    if (Date.now() - start > timeout) throw new Error("Timed out waiting for a Live transcript")
    await delay(50)
  }
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "wingman-smoke-"))
  const response = await fetch("https://storage.googleapis.com/generativeai-downloads/data/hello_are_you_there.pcm", { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error("Could not download Google's public speech fixture")
  pcm = Buffer.from(await response.arrayBuffer())
  try {
    execFileSync("espeak", ["-w", path.join(directory, "question.wav"), "Our deadline is Friday and two tasks are blocked. What should our next steps be?"], { stdio: "ignore" })
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(directory, "question.wav"), "-f", "s16le", "-ar", "16000", "-ac", "1", path.join(directory, "question.pcm")], { stdio: "ignore" })
    automaticPcm = await readFile(path.join(directory, "question.pcm"))
  } catch { automaticPcm = pcm }
  await writeFile(path.join(directory, "speech.wav"), wav(pcm))
  const image = sharp({ create: { width: 128, height: 128, channels: 3, background: "#ff0000" } })
  await image.png().toFile(path.join(directory, "red.png"))
  jpeg = await sharp(path.join(directory, "red.png")).jpeg().toBuffer()
}, 30000)
afterAll(async () => { llm.reset(); if (directory) await rm(directory, { recursive: true, force: true }) })

describe("authenticated Gemini checks", () => {
  it("Flash-Lite streams text and remembers the previous turn", async () => {
    let deltas = 0
    await llm.streamChat("smoke-first", "The codeword is maple. Reply only Ready.", () => deltas++)
    const answer = await llm.streamChat("smoke-second", "What is the codeword? Reply with one word.", () => {})
    expect(deltas).toBeGreaterThan(0); expect(answer.toLowerCase()).toContain("maple")
  })
  it("Flash-Lite analyzes an image and returns the structured solution shape", async () => {
    const image = await llm.analyzeImageFile(path.join(directory, "red.png"))
    expect(image.text.toLowerCase()).toContain("red")
    const result = await llm.generateSolution({ problem_statement: "We need to schedule a team meeting. Suggest two next steps." })
    expect(result.solution.code).toBeTruthy(); expect(Array.isArray(result.solution.thoughts)).toBe(true)
    expect(result.solution.time_complexity).toBeTruthy(); expect(result.solution.space_complexity).toBeTruthy()
  })
  it.each(["wav", "mp3", "webm"])("Flash-Lite understands the public speech fixture as %s", async extension => {
    const file = path.join(directory, `speech.${extension}`)
    if (extension !== "wav") execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(directory, "speech.wav"), file], { stdio: "ignore" })
    const result = await llm.analyzeAudioFile(file)
    expect(result.text.trim().length).toBeGreaterThan(0)
  })
  it("Live accepts PCM and a screen frame and returns input/output transcripts", async () => {
    const events: LiveEvent[] = [], live = new LiveHelper(llm, event => events.push(event))
    try {
      await live.start(); live.sendFrame(jpeg.toString("base64")); live.flushFrame()
      for (let offset = 0; offset < pcm.length; offset += 3200) { live.sendAudio(pcm.subarray(offset, offset + 3200)); await delay(100) }
      for (let i = 0; i < 20; i++) { live.sendAudio(new Uint8Array(3200)); await delay(100) }
      live.pauseAudio(); live.sendText("Give a brief useful observation about the image and the greeting.")
      await waitFor(() => events.some(event => event.type === "caption" && !!event.text) && events.some(event => event.type === "suggestion" && !!event.text), events)
      expect(events.some(event => event.status === "active")).toBe(true)
      expect(live.state).toBe("active")
    } finally { live.stop() }
  })
  it("Live automatically provides assistance for a spoken question", async () => {
    const events: LiveEvent[] = [], live = new LiveHelper(llm, event => events.push(event))
    try {
      await live.start(); live.sendFrame(jpeg.toString("base64")); live.flushFrame()
      for (let offset = 0; offset < automaticPcm.length; offset += 3200) { live.sendAudio(automaticPcm.subarray(offset, offset + 3200)); await delay(100) }
      for (let i = 0; i < 25; i++) { live.sendAudio(new Uint8Array(3200)); await delay(100) }
      await waitFor(() => events.some(event => event.type === "caption" && !!event.text) && events.some(event => event.type === "suggestion" && !!event.text), events)
    } finally { live.stop() }
  })
  it("Live resumes its conversation after an induced socket disconnect", async () => {
    const events: LiveEvent[] = [], live = new LiveHelper(llm, event => events.push(event))
    try {
      await live.start()
      live.sendText("Remember the codeword maple. Reply only Ready.")
      await waitFor(() => events.some(event => event.type === "suggestion" && event.final), events)
      await delay(1000)
      const socket = (live as unknown as { session?: { close(): void } }).session
      if (!socket) throw new Error("No Live socket to exercise resumption")
      socket.close()
      await waitFor(() => events.filter(event => event.status === "active").length >= 2, events)
      live.sendText("What is the codeword? Reply with only that word.")
      await waitFor(() => events.some(event => event.type === "suggestion" && event.text?.toLowerCase().includes("maple")), events)
      expect(events.some(event => event.status === "reconnecting")).toBe(true)
    } finally { live.stop() }
  })
  const soakSeconds = Number(process.env.GEMINI_SOAK_SECONDS || 0)
  it.skipIf(!soakSeconds)("Live remains connected with mixed inputs across server connection rotation", async () => {
    const events: LiveEvent[] = [], counters = { reconnects: 0, active: 0, errors: 0 }
    const live = new LiveHelper(llm, event => {
      events.push(event); if (events.length > 100) events.shift()
      if (event.status === "reconnecting") counters.reconnects++
      if (event.status === "active") counters.active++
      if (event.type === "error") counters.errors++
    })
    let audioTimer: ReturnType<typeof setInterval> | undefined, frameTimer: ReturnType<typeof setInterval> | undefined
    try {
      await live.start()
      const start = Date.now(); let offset = 0
      audioTimer = setInterval(() => {
        const speechTime = (Date.now() - start) % 30000 < pcm.length / 32
        live.sendAudio(speechTime ? pcm.subarray(offset, Math.min(offset + 3200, pcm.length)) : new Uint8Array(3200))
        offset = speechTime ? (offset + 3200) % pcm.length : 0
      }, 100)
      frameTimer = setInterval(() => { live.sendFrame(jpeg.toString("base64")); live.flushFrame() }, 1000)
      while (Date.now() - start < soakSeconds * 1000) {
        await delay(1000)
        if (live.state === "error") throw new Error(events.findLast(event => event.type === "error")?.error || "Live soak failed")
      }
      expect(counters.errors).toBe(0); expect(live.state).toBe("active")
      console.log(JSON.stringify({ soakSeconds, ...counters, totalTokens: events.findLast(event => event.usage)?.usage?.totalTokens }))
    } finally { clearInterval(audioTimer); clearInterval(frameTimer); live.stop() }
  }, (soakSeconds + 45) * 1000)
})
