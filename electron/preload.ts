import { contextBridge, ipcRenderer } from "electron"
import type { ElectronAPI } from "./contracts"

function listen<T>(channel: string, callback: (data: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
const api: ElectronAPI = {
  updateContentDimensions: dimensions => ipcRenderer.invoke("update-content-dimensions", dimensions),
  takeScreenshot: () => ipcRenderer.invoke("take-screenshot"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: path => ipcRenderer.invoke("delete-screenshot", path),
  onScreenshotTaken: callback => listen("screenshot-taken", callback),
  onSolutionsReady: callback => listen("solutions-ready", callback),
  onResetView: callback => listen("reset-view", callback),
  onSolutionStart: callback => listen("initial-start", callback),
  onDebugStart: callback => listen("debug-start", callback),
  onDebugSuccess: callback => listen("debug-success", callback),
  onDebugError: callback => listen("debug-error", callback),
  onSolutionError: callback => listen("solution-error", callback),
  onProcessingNoScreenshots: callback => listen("processing-no-screenshots", callback),
  onProblemExtracted: callback => listen("problem-extracted", callback),
  onSolutionSuccess: callback => listen("solution-success", callback),
  onUnauthorized: callback => listen("procesing-unauthorized", callback),
  moveWindowLeft: () => ipcRenderer.invoke("move-window-left"),
  moveWindowRight: () => ipcRenderer.invoke("move-window-right"),
  moveWindowUp: () => ipcRenderer.invoke("move-window-up"),
  moveWindowDown: () => ipcRenderer.invoke("move-window-down"),
  analyzeAudioFromBase64: (data, mime) => ipcRenderer.invoke("analyze-audio-base64", data, mime),
  analyzeAudioFile: path => ipcRenderer.invoke("analyze-audio-file", path),
  analyzeImageFile: path => ipcRenderer.invoke("analyze-image-file", path),
  quitApp: () => ipcRenderer.invoke("quit-app"),
  getCurrentLlmConfig: () => ipcRenderer.invoke("get-current-llm-config"),
  onLlmConfig: callback => listen("llm-config", callback),
  getAvailableOllamaModels: () => ipcRenderer.invoke("get-available-ollama-models"),
  switchToOllama: (model, url) => ipcRenderer.invoke("switch-to-ollama", model, url),
  switchToGemini: key => ipcRenderer.invoke("switch-to-gemini", key),
  testLlmConnection: () => ipcRenderer.invoke("test-llm-connection"),
  startChat: (id, message) => ipcRenderer.invoke("chat-start", id, message),
  cancelChat: id => ipcRenderer.invoke("chat-cancel", id),
  onChatEvent: callback => listen("chat-event", callback),
  getCaptureCapabilities: () => ipcRenderer.invoke("capture-capabilities"),
  getCaptureSources: () => ipcRenderer.invoke("capture-sources"),
  selectCaptureSource: (id, audio) => ipcRenderer.invoke("capture-select", id, audio),
  getOverlayMask: id => ipcRenderer.invoke("capture-mask", id),
  startLive: options => ipcRenderer.invoke("live-start", options),
  stopLive: () => ipcRenderer.invoke("live-stop"),
  testLiveConnection: () => ipcRenderer.invoke("live-test"),
  sendLiveAudio: packet => ipcRenderer.send("live-audio", packet),
  sendLiveFrame: packet => ipcRenderer.send("live-frame", packet),
  pauseLiveAudio: id => ipcRenderer.invoke("live-audio-pause", id),
  onLiveEvent: callback => listen("live-event", callback)
}
contextBridge.exposeInMainWorld("electronAPI", api)
