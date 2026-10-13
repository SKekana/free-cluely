import type { Content, GoogleGenAI, Part } from "@google/genai" with { "resolution-mode": "import" }
import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { DEFAULT_GEMINI_MODEL, DEFAULT_LIVE_MODEL, MAX_CLIP_BYTES } from "./contracts"
import type { AnalysisResult, ConnectionStatus, LlmConfig, SolutionResult } from "./contracts"
import { extractedProblemSchema, jsonSchema, solutionSchema } from "./schemas"
import { audioMime, errorMessage, isTransient, normalizeAudioMime, validateClip } from "./media"

export type ClientFactory = (key: string) => Promise<GoogleGenAI>
const createClient: ClientFactory = async (apiKey) => {
  const { GoogleGenAI } = await import("@google/genai")
  return new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta", timeout: 45000 } })
}
const SYSTEM_PROMPT = "You are Wingman AI, a helpful assistant for meetings, questions and coding. Give concise, practical answers and suggested next steps. Provide a brief rationale when useful."

export class LLMHelper {
  private apiKey?: string
  private client?: Promise<GoogleGenAI>
  private useOllama: boolean
  private ollamaModel: string
  private ollamaUrl: string
  private status: ConnectionStatus
  private history: Content[] = []
  private context: string[] = []
  private images = new Map<string, Promise<AnalysisResult>>()
  private epoch = 0
  private chatBusy = false
  private requests = new Map<string, AbortController>()
  readonly geminiModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL
  readonly liveModel = process.env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL

  constructor(apiKey?: string, useOllama = false, ollamaModel = "llama3.2", ollamaUrl = "http://localhost:11434", private factory: ClientFactory = createClient) {
    this.apiKey = apiKey?.trim() || undefined
    this.useOllama = useOllama
    this.ollamaModel = ollamaModel
    this.ollamaUrl = ollamaUrl
    this.status = this.getCurrentProvider() === "unconfigured" ? "unconfigured" : "configured"
  }
  getConfig(): LlmConfig {
    const provider = this.getCurrentProvider()
    const gemini = provider === "gemini"
    return { provider, model: this.getCurrentModel(), liveModel: this.liveModel, isOllama: this.useOllama,
      configured: provider !== "unconfigured", revision: this.epoch, connectionStatus: this.status,
      capabilities: { text: provider !== "unconfigured", image: gemini, audio: gemini, structured: gemini, live: gemini } }
  }
  getCurrentProvider(): LlmConfig["provider"] { return this.useOllama ? "ollama" : this.apiKey ? "gemini" : "unconfigured" }
  getCurrentModel(): string { return this.useOllama ? this.ollamaModel : this.geminiModel }
  isUsingOllama(): boolean { return this.useOllama }
  async getGeminiClient(): Promise<GoogleGenAI> {
    if (this.useOllama) throw new Error("This feature requires Gemini. Ollama currently supports text chat only.")
    if (!this.apiKey) throw new Error("Configure a Gemini API key in Models to use this feature.")
    return this.client ??= this.factory(this.apiKey).catch(error => { this.client = undefined; throw new Error(this.describeError(error)) })
  }
  describeError(error: unknown): string { return errorMessage(error, this.apiKey) }
  cancelRequest(id: string): void { this.requests.get(id)?.abort() }
  cancelAll(): void { for (const controller of this.requests.values()) controller.abort(); this.requests.clear(); this.epoch++ }
  reset(): void { this.cancelAll(); this.history = []; this.context = []; this.images.clear() }
  private async request<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, id: string = randomUUID()): Promise<T> {
    if (this.requests.has(id)) throw new Error("Duplicate request ID")
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) controller.abort()
    this.requests.set(id, controller)
    try { controller.signal.throwIfAborted(); return await run(controller.signal) }
    catch (error) { if (controller.signal.aborted) throw new DOMException("Request canceled", "AbortError"); throw new Error(this.describeError(error)) }
    finally { signal?.removeEventListener("abort", abort); if (this.requests.get(id) === controller) this.requests.delete(id) }
  }
  private async retry<T>(run: () => Promise<T>, signal: AbortSignal, canRetry = () => true): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      try { return await run() }
      catch (error) { if (attempt >= 2 || signal.aborted || !canRetry() || !isTransient(error)) throw error; await delay(500 * 2 ** attempt, undefined, { signal }) }
    }
  }
  private current(epoch: number, signal?: AbortSignal): void {
    signal?.throwIfAborted()
    if (epoch !== this.epoch) throw new DOMException("Request canceled", "AbortError")
  }
  private remember(text: string): void { this.context = [...this.context, text.slice(0, 12000)].slice(-3) }
  private async generate(parts: Part[], schema?: unknown, external?: AbortSignal): Promise<string> {
    const size = parts.reduce((bytes, part) => bytes + Buffer.byteLength(part.text || "") + (part.inlineData?.data?.length || 0), 0)
    if (size > 18 * 1024 * 1024) throw new Error("Captured media is too large for one request. Use fewer or smaller images.")
    return this.request(async signal => {
      const client = await this.getGeminiClient()
      signal.throwIfAborted()
      const response = await this.retry(() => client.models.generateContent({ model: this.geminiModel, contents: [{ role: "user", parts }],
        config: { systemInstruction: SYSTEM_PROMPT, abortSignal: signal, maxOutputTokens: 4096,
          ...(schema ? { responseMimeType: "application/json", responseJsonSchema: schema } : {}) } }), signal)
      signal.throwIfAborted()
      if (!response.text?.trim()) throw new Error("The model returned no text. Try a different input.")
      return response.text
    }, external)
  }
  private async imagePart(file: string): Promise<Part> {
    const data = await fs.readFile(file)
    if (data.length > MAX_CLIP_BYTES) throw new Error("Images must be 10 MB or smaller")
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Use a PNG screenshot for image analysis")
    return { inlineData: { data: data.toString("base64"), mimeType: "image/png" } }
  }
  async analyzeImageFile(file: string, signal?: AbortSignal): Promise<AnalysisResult> {
    const epoch = this.epoch
    await this.getGeminiClient()
    this.current(epoch, signal)
    const existing = this.images.get(file)
    if (existing) { const result = await existing; this.current(epoch, signal); return result }
    const request = (async () => {
      const image = await this.imagePart(file)
      this.current(epoch, signal)
      const text = await this.generate([{ text: "Analyze this screenshot briefly and suggest useful responses or next steps." }, image], undefined, signal)
      if (epoch !== this.epoch) throw new DOMException("Request canceled", "AbortError")
      this.remember(text)
      return { text, timestamp: Date.now() }
    })()
    this.images.set(file, request)
    if (this.images.size > 5) this.images.delete(this.images.keys().next().value!)
    try { return await request } catch (error) { if (this.images.get(file) === request) this.images.delete(file); throw error }
  }
  async analyzeAudioFromBase64(data: string, mime: string, signal?: AbortSignal): Promise<AnalysisResult> {
    const epoch = this.epoch
    await this.getGeminiClient()
    this.current(epoch, signal)
    validateClip(data)
    const text = await this.generate([{ text: "Describe or transcribe this audio briefly and suggest useful responses or next steps." }, { inlineData: { data, mimeType: normalizeAudioMime(mime) } }], undefined, signal)
    if (epoch !== this.epoch) throw new DOMException("Request canceled", "AbortError")
    this.remember(text)
    return { text, timestamp: Date.now() }
  }
  async analyzeAudioFile(file: string, signal?: AbortSignal): Promise<AnalysisResult> {
    const epoch = this.epoch
    await this.getGeminiClient()
    this.current(epoch, signal)
    if ((await fs.stat(file)).size > MAX_CLIP_BYTES) throw new Error("Audio clips must be 10 MB or smaller")
    const bytes = await fs.readFile(file)
    this.current(epoch, signal)
    return this.analyzeAudioFromBase64(bytes.toString("base64"), audioMime(bytes, path.extname(file)), signal)
  }
  async extractProblemFromImages(files: string[], signal?: AbortSignal) {
    const epoch = this.epoch
    await this.getGeminiClient()
    const images = await Promise.all(files.map(file => this.imagePart(file)))
    this.current(epoch, signal)
    const text = await this.generate([{ text: "Extract the problem or situation, context, suggested responses and brief rationale from these images." }, ...images], jsonSchema(extractedProblemSchema), signal)
    return extractedProblemSchema.parse(JSON.parse(text))
  }
  async generateSolution(problem: unknown, signal?: AbortSignal): Promise<SolutionResult> {
    const text = await this.generate([{ text: `Provide a solution to this situation: ${JSON.stringify(problem)}. Include practical thoughts and complexity fields; use N/A for complexity when the answer is not code.` }], jsonSchema(solutionSchema), signal)
    return solutionSchema.parse(JSON.parse(text))
  }
  async debugSolutionWithImages(problem: unknown, code: string, files: string[], signal?: AbortSignal): Promise<SolutionResult> {
    const epoch = this.epoch
    await this.getGeminiClient()
    const images = await Promise.all(files.map(file => this.imagePart(file)))
    this.current(epoch, signal)
    const text = await this.generate([{ text: `Improve the current answer using the new screenshots. Situation: ${JSON.stringify(problem)}. Current answer: ${code}. Use N/A for non-code complexity.` }, ...images], jsonSchema(solutionSchema), signal)
    return solutionSchema.parse(JSON.parse(text))
  }
  async streamChat(id: string, message: string, onDelta: (text: string) => void): Promise<string> {
    if (this.chatBusy) throw new Error("Wait for the current reply or cancel it first.")
    if (!message.trim() || message.length > 20000) throw new Error("Messages must contain 1–20,000 characters")
    this.chatBusy = true
    const epoch = this.epoch
    const turn: Content = { role: "user", parts: [{ text: message }] }
    try {
      return await this.request(async signal => {
        let text = ""
        if (this.useOllama) {
          const response = await fetch(`${this.ollamaUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, signal,
            body: JSON.stringify({ model: this.ollamaModel, stream: false, messages: [{ role: "system", content: SYSTEM_PROMPT },
              ...this.history.map(item => ({ role: item.role === "model" ? "assistant" : "user", content: item.parts?.map(part => part.text || "").join("") })), { role: "user", content: message }] }) })
          if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}. Check the server and model.`)
          const result = await response.json() as { message?: { content?: string } }
          text = result.message?.content || ""
          signal.throwIfAborted()
          onDelta(text)
        } else {
          const client = await this.getGeminiClient()
          await this.retry(async () => {
            const stream = await client.models.generateContentStream({ model: this.geminiModel, contents: [...this.history, turn],
              config: { systemInstruction: SYSTEM_PROMPT + (this.context.length ? `\nRecent captured context:\n${this.context.join("\n")}` : ""), abortSignal: signal, maxOutputTokens: 4096 } })
            for await (const chunk of stream) { signal.throwIfAborted(); if (chunk.text) { text += chunk.text; onDelta(chunk.text) } }
          }, signal, () => !text)
        }
        signal.throwIfAborted()
        if (!text.trim()) throw new Error("The model returned no text")
        if (epoch !== this.epoch) throw new DOMException("Request canceled", "AbortError")
        this.history = [...this.history, turn, { role: "model", parts: [{ text }] }].slice(-40)
        return text
      }, undefined, id)
    } finally { this.chatBusy = false }
  }
  async chatWithGemini(message: string): Promise<string> { return this.streamChat(randomUUID(), message, () => {}) }
  async chat(message: string): Promise<string> { return this.chatWithGemini(message) }
  async getOllamaModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) return []
      const data = await response.json() as { models?: { name: string }[] }
      return data.models?.map(model => model.name) || []
    } catch { return [] }
  }
  async switchToOllama(model?: string, url?: string): Promise<void> {
    this.reset()
    if (url) { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Use an HTTP or HTTPS Ollama URL"); this.ollamaUrl = url.replace(/\/$/, "") }
    if (model) this.ollamaModel = model
    else this.ollamaModel = (await this.getOllamaModels())[0] || this.ollamaModel
    this.useOllama = true
    this.status = "configured"
  }
  async switchToGemini(apiKey?: string): Promise<void> {
    const nextKey = apiKey?.trim() || this.apiKey
    if (!nextKey) throw new Error("Enter a Gemini API key")
    this.reset()
    if (nextKey !== this.apiKey) { this.apiKey = nextKey; this.client = undefined }
    this.useOllama = false
    this.status = "configured"
  }
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    this.status = "testing"
    try {
      if (this.useOllama) {
        const response = await fetch(`${this.ollamaUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ model: this.ollamaModel, stream: false, messages: [{ role: "user", content: "Reply OK." }] }) })
        if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`)
      } else await this.generate([{ text: "Reply OK." }])
      this.status = "connected"
      return { success: true }
    } catch (error) { this.status = "error"; return { success: false, error: this.describeError(error) } }
  }
}
