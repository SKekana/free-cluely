// ipcHandlers.ts

import { ipcMain, app } from "electron"
import type { AppState } from "./main"
import type { AudioPacket, FramePacket, LiveOptions } from "./contracts"
import { z } from "zod"

export function initializeIpcHandlers(appState: AppState): void {
  const llm = appState.processingHelper.getLLMHelper()
  const broadcastConfig = () => appState.getMainWindow()?.webContents.send("llm-config", llm.getConfig())
  ipcMain.handle("chat-start", (event, requestId: string, message: string) => {
    if (typeof requestId !== "string" || !/^[\w-]{1,100}$/.test(requestId) || typeof message !== "string") return { success: false, error: "Invalid chat request" }
    void llm.streamChat(requestId, message, text => {
      if (!event.sender.isDestroyed()) event.sender.send("chat-event", { requestId, type: "delta", text })
    }).then(text => {
      if (!event.sender.isDestroyed()) event.sender.send("chat-event", { requestId, type: "done", text })
    }).catch(error => {
      if (!event.sender.isDestroyed()) event.sender.send("chat-event", { requestId, type: error.name === "AbortError" ? "canceled" : "error", error: llm.describeError(error) })
    })
    return { success: true }
  })
  ipcMain.handle("chat-cancel", (_, id: string) => llm.cancelRequest(id))
  ipcMain.handle("capture-capabilities", () => appState.captureHelper.capabilities())
  ipcMain.handle("capture-sources", () => appState.captureHelper.list())
  ipcMain.handle("capture-select", (_, id: string, audio: boolean) => appState.captureHelper.select(id, audio))
  ipcMain.handle("capture-mask", (_, id: string) => appState.captureHelper.mask(id))
  const liveOptions = z.object({ microphone: z.boolean(), systemAudio: z.boolean(), screen: z.boolean(), sourceId: z.string().optional(), systemSourceId: z.string().optional() })
  ipcMain.handle("live-start", (_, options: LiveOptions) => appState.startLive(liveOptions.parse(options)))
  ipcMain.handle("live-stop", () => appState.stopLive())
  ipcMain.handle("live-test", () => appState.liveHelper.testConnection())
  ipcMain.handle("live-audio-pause", (_, id: string) => { if (id === appState.liveHelper.sessionId) appState.liveHelper.pauseAudio() })
  ipcMain.on("live-audio", (_, packet: AudioPacket) => { if (packet && typeof packet === "object") appState.receiveAudio(packet) })
  ipcMain.on("live-frame", (_, packet: FramePacket) => { if (packet && typeof packet === "object") appState.receiveFrame(packet) })
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        appState.setWindowDimensions(width, height)
      }
    }
  )

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return appState.deleteScreenshot(path)
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await appState.takeScreenshot()
      const preview = await appState.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      console.error("Error taking screenshot:", error)
      throw error
    }
  })

  ipcMain.handle("get-screenshots", async () => {
    console.log({ view: appState.getView() })
    try {
      let previews = []
      if (appState.getView() === "queue") {
        previews = await Promise.all(
          appState.getScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      } else {
        previews = await Promise.all(
          appState.getExtraScreenshotQueue().map(async (path) => ({
            path,
            preview: await appState.getImagePreview(path)
          }))
        )
      }
      previews.forEach((preview: any) => console.log(preview.path))
      return previews
    } catch (error) {
      console.error("Error getting screenshots:", error)
      throw error
    }
  })

  ipcMain.handle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      appState.clearQueues()
      console.log("Screenshot queues have been cleared.")
      return { success: true }
    } catch (error: any) {
      console.error("Error resetting queues:", error)
      return { success: false, error: error.message }
    }
  })

  // IPC handler for analyzing audio from base64 data
  ipcMain.handle("analyze-audio-base64", async (event, data: string, mimeType: string) => {
    try {
      const result = await appState.processingHelper.processAudioBase64(data, mimeType)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-base64 handler:", error)
      throw error
    }
  })

  // IPC handler for analyzing audio from file path
  ipcMain.handle("analyze-audio-file", async (event, path: string) => {
    try {
      const result = await appState.processingHelper.processAudioFile(path)
      return result
    } catch (error: any) {
      console.error("Error in analyze-audio-file handler:", error)
      throw error
    }
  })

  // IPC handler for analyzing image from file path
  ipcMain.handle("analyze-image-file", async (event, path: string) => {
    try {
      const result = await appState.processingHelper.getLLMHelper().analyzeImageFile(path)
      return result
    } catch (error: any) {
      console.error("Error in analyze-image-file handler:", error)
      throw error
    }
  })

  ipcMain.handle("quit-app", () => {
    app.quit()
  })

  // Window movement handlers
  ipcMain.handle("move-window-left", async () => {
    appState.moveWindowLeft()
  })

  ipcMain.handle("move-window-right", async () => {
    appState.moveWindowRight()
  })

  ipcMain.handle("move-window-up", async () => {
    appState.moveWindowUp()
  })

  ipcMain.handle("move-window-down", async () => {
    appState.moveWindowDown()
  })

  ipcMain.handle("center-and-show-window", async () => {
    appState.centerAndShowWindow()
  })

  // LLM Model Management Handlers
  ipcMain.handle("get-current-llm-config", () => llm.getConfig())

  ipcMain.handle("get-available-ollama-models", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const models = await llmHelper.getOllamaModels();
      return models;
    } catch (error: any) {
      console.error("Error getting Ollama models:", error);
      throw error;
    }
  });

  ipcMain.handle("switch-to-ollama", async (_, model?: string, url?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      appState.stopLive();
      appState.processingHelper.cancelOngoingRequests();
      await llmHelper.switchToOllama(model, url);
      broadcastConfig();
      return { success: true };
    } catch (error: any) {
      broadcastConfig();
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("switch-to-gemini", async (_, apiKey?: string) => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      appState.stopLive();
      appState.processingHelper.cancelOngoingRequests();
      await llmHelper.switchToGemini(apiKey);
      broadcastConfig();
      return { success: true };
    } catch (error: any) {
      broadcastConfig();
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("test-llm-connection", async () => {
    try {
      const llmHelper = appState.processingHelper.getLLMHelper();
      const pending = llmHelper.testConnection();
      broadcastConfig();
      const result = await pending;
      broadcastConfig();
      return result;
    } catch (error: any) {
      console.error("Error testing LLM connection:", error);
      return { success: false, error: error.message };
    }
  });
}
