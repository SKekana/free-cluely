import type { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import dotenv from "dotenv"
import { problemFromText } from "./schemas"

dotenv.config({ quiet: true })

export class ProcessingHelper {
  private llmHelper: LLMHelper
  private processing?: AbortController
  constructor(private appState: AppState) {
    this.llmHelper = new LLMHelper(process.env.GEMINI_API_KEY, process.env.USE_OLLAMA === "true", process.env.OLLAMA_MODEL, process.env.OLLAMA_URL)
  }
  async processScreenshots(): Promise<void> {
    const window = this.appState.getMainWindow()
    if (!window) return
    const initial = this.appState.getView() === "queue"
    const paths = initial ? this.appState.getScreenshotHelper().getScreenshotQueue() : this.appState.getScreenshotHelper().getExtraScreenshotQueue()
    if (!paths.length) { window.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS); return }
    this.processing?.abort()
    const controller = new AbortController(); this.processing = controller
    window.webContents.send(initial ? this.appState.PROCESSING_EVENTS.INITIAL_START : this.appState.PROCESSING_EVENTS.DEBUG_START)
    if (initial) this.appState.setView("solutions")
    try {
      if (initial) {
        const result = await this.llmHelper.analyzeImageFile(paths[paths.length - 1], controller.signal)
        controller.signal.throwIfAborted()
        const problem = problemFromText(result.text)
        this.appState.setProblemInfo(problem)
        window.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problem)
      } else {
        const problem = this.appState.getProblemInfo()
        if (!problem) throw new Error("Capture a problem before debugging it")
        const current = await this.llmHelper.generateSolution(problem, controller.signal)
        const result = await this.llmHelper.debugSolutionWithImages(problem, current.solution.code, paths, controller.signal)
        controller.signal.throwIfAborted()
        this.appState.setHasDebugged(true)
        window.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS, result)
      }
    } catch (error) {
      if (!controller.signal.aborted) window.webContents.send(initial ? this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR : this.appState.PROCESSING_EVENTS.DEBUG_ERROR, this.llmHelper.describeError(error))
    } finally { if (this.processing === controller) this.processing = undefined }
  }
  cancelOngoingRequests(): void { this.processing?.abort(); this.processing = undefined; this.llmHelper.reset(); this.appState.setHasDebugged(false) }
  processAudioBase64(data: string, mimeType: string) { return this.llmHelper.analyzeAudioFromBase64(data, mimeType) }
  processAudioFile(file: string) { return this.llmHelper.analyzeAudioFile(file) }
  getLLMHelper(): LLMHelper { return this.llmHelper }
}
