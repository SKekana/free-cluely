// Pure shared contracts: safe to import from the renderer and the preload.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
export const DEFAULT_LIVE_MODEL = "gemini-3.8-live"
export const MAX_CLIP_BYTES = 10 * 1024 * 1024
export const MAX_CLIP_SECONDS = 120
export type Provider = "gemini" | "ollama" | "unconfigured"
export type ConnectionStatus = "unconfigured" | "configured" | "testing" | "connected" | "error"
export interface ActionResult { success: boolean; error?: string }
export interface LlmConfig {
  provider: Provider
  model: string
  liveModel: string
  isOllama: boolean
  configured: boolean
  revision: number
  connectionStatus: ConnectionStatus
  capabilities: { text: boolean; image: boolean; audio: boolean; structured: boolean; live: boolean }
}
export interface AnalysisResult { text: string; timestamp: number }
export interface ProblemInfo {
  problem_statement: string
  input_format: { description: string; parameters: unknown[] }
  output_format: { description: string; type: string; subtype: string }
  complexity: { time: string; space: string }
  test_cases: unknown[]
  validation_type: string
  difficulty: string
  context?: string
  suggested_responses?: string[]
  reasoning?: string
}
export interface SolutionResult {
  solution: {
    code: string; thoughts: string[]; time_complexity: string; space_complexity: string
    problem_statement: string; context: string; suggested_responses: string[]; reasoning: string
  }
}
export interface Screenshot { path: string; preview: string }
export type ChatEvent = {
  requestId: string; type: "delta" | "done" | "error" | "canceled"; text?: string; error?: string
}
export interface CaptureSource {
  id: string; name: string; kind: "screen" | "window"; thumbnail: string
  bounds?: { x: number; y: number; width: number; height: number }
}
export interface SystemAudioSource { id: string; name: string }
export interface CaptureCapabilities {
  platform: string; screen: boolean; systemAudio: boolean; systemAudioReason?: string
  systemSources: SystemAudioSource[]
}
export interface LiveOptions {
  microphone: boolean; systemAudio: boolean; screen: boolean
  sourceId?: string; systemSourceId?: string
}
export type LiveStatus = "idle" | "connecting" | "active" | "reconnecting" | "error"
export type LiveEvent = {
  sessionId: string; type: "status" | "caption" | "suggestion" | "interrupted" | "usage" | "error"
  status?: LiveStatus; text?: string; turnId?: number; final?: boolean; error?: string
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
  elapsedMs?: number; latencyMs?: number
}
export interface AudioPacket { sessionId: string; source: "microphone" | "system"; data: Uint8Array }
export interface FramePacket { sessionId: string; data: string }
export interface OverlayMask { x: number; y: number; width: number; height: number }
export interface ElectronAPI {
  updateContentDimensions(dimensions: { width: number; height: number }): Promise<void>
  getScreenshots(): Promise<Screenshot[]>
  deleteScreenshot(path: string): Promise<ActionResult>
  takeScreenshot(): Promise<Screenshot>
  onScreenshotTaken(callback: (data: Screenshot) => void): () => void
  onSolutionsReady(callback: (solutions: string) => void): () => void
  onResetView(callback: () => void): () => void
  onSolutionStart(callback: () => void): () => void
  onDebugStart(callback: () => void): () => void
  onDebugSuccess(callback: (data: SolutionResult) => void): () => void
  onSolutionError(callback: (error: string) => void): () => void
  onProcessingNoScreenshots(callback: () => void): () => void
  onProblemExtracted(callback: (data: ProblemInfo) => void): () => void
  onSolutionSuccess(callback: (data: SolutionResult) => void): () => void
  onUnauthorized(callback: () => void): () => void
  onDebugError(callback: (error: string) => void): () => void
  moveWindowLeft(): Promise<void>
  moveWindowRight(): Promise<void>
  moveWindowUp(): Promise<void>
  moveWindowDown(): Promise<void>
  analyzeAudioFromBase64(data: string, mimeType: string): Promise<AnalysisResult>
  analyzeAudioFile(path: string): Promise<AnalysisResult>
  analyzeImageFile(path: string): Promise<AnalysisResult>
  quitApp(): Promise<void>
  getCurrentLlmConfig(): Promise<LlmConfig>
  onLlmConfig(callback: (config: LlmConfig) => void): () => void
  getAvailableOllamaModels(): Promise<string[]>
  switchToOllama(model?: string, url?: string): Promise<ActionResult>
  switchToGemini(apiKey?: string): Promise<ActionResult>
  testLlmConnection(): Promise<ActionResult>
  startChat(requestId: string, message: string): Promise<ActionResult>
  cancelChat(requestId: string): Promise<void>
  onChatEvent(callback: (event: ChatEvent) => void): () => void
  getCaptureCapabilities(): Promise<CaptureCapabilities>
  getCaptureSources(): Promise<CaptureSource[]>
  selectCaptureSource(sourceId: string, systemAudio: boolean): Promise<void>
  getOverlayMask(sourceId: string): Promise<OverlayMask | null>
  startLive(options: LiveOptions): Promise<{ sessionId: string }>
  stopLive(): Promise<void>
  testLiveConnection(): Promise<ActionResult>
  sendLiveAudio(packet: AudioPacket): void
  sendLiveFrame(packet: FramePacket): void
  pauseLiveAudio(sessionId: string): Promise<void>
  onLiveEvent(callback: (event: LiveEvent) => void): () => void
}
