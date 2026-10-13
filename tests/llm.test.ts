import { describe, it, expect, vi } from "vitest"
import type { GoogleGenAI } from "@google/genai"
import { LLMHelper } from "../electron/LLMHelper"
import { solutionSchema } from "../electron/schemas"
import { audioMime, normalizeAudioMime, validateClip, errorMessage } from "../electron/media"

function fixture(stream?: (request: any) => AsyncGenerator<{ text: string }>) {
  const generateContent = vi.fn(async () => ({ text: "A concise answer" }))
  const generateContentStream = vi.fn(stream || (async function* () { yield { text: "Hello " }; yield { text: "there" } }))
  const client = { models: { generateContent, generateContentStream } } as unknown as GoogleGenAI
  const factory = vi.fn(async () => client)
  return { llm: new LLMHelper("test-key", false, undefined, undefined, factory), factory, generateContent, generateContentStream }
}
describe("provider isolation and configuration", () => {
  it("starts unconfigured without crashing or requesting a model", () => {
    expect(new LLMHelper().getConfig()).toMatchObject({ provider: "unconfigured", configured: false, capabilities: { live: false } })
  })
  it("never calls Gemini for images, clips or structured output after switching to Ollama", async () => {
    const { llm, factory } = fixture()
    await llm.switchToOllama("local-model")
    await expect(llm.analyzeImageFile("/missing.png")).rejects.toThrow("Ollama")
    await expect(llm.analyzeAudioFromBase64("AAAA", "audio/wav")).rejects.toThrow("Ollama")
    await expect(llm.generateSolution({})).rejects.toThrow("Ollama")
    expect(factory).not.toHaveBeenCalled()
  })
  it("does not replace Ollama with an unconfigured provider when a key is missing", async () => {
    const llm = new LLMHelper(undefined, true, "local-model")
    await expect(llm.switchToGemini()).rejects.toThrow("API key")
    expect(llm.getConfig().provider).toBe("ollama")
  })
  it("configuration is not reported as a verified connection", async () => {
    const { llm } = fixture()
    expect(llm.getConfig().connectionStatus).toBe("configured")
    expect(await llm.testConnection()).toEqual({ success: true })
    expect(llm.getConfig().connectionStatus).toBe("connected")
  })
})
describe("conversation and cancellation", () => {
  it("streams deltas and sends both previous roles on the next turn", async () => {
    const { llm, generateContentStream } = fixture()
    const delta = vi.fn()
    expect(await llm.streamChat("first", "Remember the word maple", delta)).toBe("Hello there")
    expect(delta.mock.calls.flat()).toEqual(["Hello ", "there"])
    await llm.streamChat("second", "What word?", () => {})
    const contents = generateContentStream.mock.calls[1][0].contents
    expect(contents.map((item: any) => item.role)).toEqual(["user", "model", "user"])
    expect(contents[0].parts[0].text).toContain("maple")
  })
  it("bounds history to 20 completed turns and clears it on reset", async () => {
    const { llm, generateContentStream } = fixture()
    for (let i = 0; i < 23; i++) await llm.streamChat(`turn-${i}`, `Question ${i}`, () => {})
    expect(generateContentStream.mock.calls.at(-1)![0].contents.length).toBe(41)
    llm.reset(); await llm.streamChat("fresh", "New question", () => {})
    expect(generateContentStream.mock.calls.at(-1)![0].contents.length).toBe(1)
  })
  it("cancels media work that is still awaiting client initialization", async () => {
    let initialize!: (client: GoogleGenAI) => void
    const generateContent = vi.fn()
    const llm = new LLMHelper("test-key", false, undefined, undefined, () => new Promise(resolve => { initialize = resolve }))
    const pending = llm.analyzeAudioFromBase64("AAAA", "audio/wav")
    llm.reset()
    initialize({ models: { generateContent } } as unknown as GoogleGenAI)
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(generateContent).not.toHaveBeenCalled()
  })
  it("does not commit a partial reply or deliver new deltas after cancellation", async () => {
    let release!: () => void
    const { llm, generateContentStream } = fixture(async function* () {
      yield { text: "partial" }
      await new Promise<void>(resolve => { release = resolve })
      yield { text: "late" }
    })
    const delta = vi.fn()
    const pending = llm.streamChat("cancel", "Question", delta)
    while (!release) await new Promise(resolve => setTimeout(resolve, 0))
    llm.cancelRequest("cancel"); release()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(delta).toHaveBeenCalledTimes(1)
    generateContentStream.mockImplementation(async function* () { yield { text: "fresh" } })
    await llm.streamChat("next", "New question", () => {})
    expect(generateContentStream.mock.calls.at(-1)![0].contents).toHaveLength(1)
  })
})
describe("media and structured output", () => {
  it("recognizes WAV bytes even when a filename claims MP3 and removes codec parameters", () => {
    const wav = Buffer.from("RIFF0000WAVE")
    expect(audioMime(wav, ".mp3")).toBe("audio/wav")
    expect(normalizeAudioMime("audio/webm;codecs=opus")).toBe("audio/webm")
    expect(() => validateClip("not base64!")).toThrow()
    expect(() => validateClip(Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"))).toThrow("10 MB")
  })
  it("rejects a legacy solution that would leave rendered fields undefined", () => {
    expect(solutionSchema.safeParse({ solution: { code: "Answer", reasoning: "Why" } }).success).toBe(false)
  })
  it("redacts credentials in API and socket errors", () => {
    const secret = "AIza" + "A".repeat(35)
    expect(errorMessage(new Error(`Failure key=${secret}`), secret)).not.toContain(secret)
  })
})
