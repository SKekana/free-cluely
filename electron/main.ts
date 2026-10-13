import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron"
import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts"
import { ProcessingHelper } from "./ProcessingHelper"
import { CaptureHelper } from "./CaptureHelper"
import { LiveHelper } from "./LiveHelper"
import { SystemAudioCapture } from "./SystemAudioCapture"
import { PcmMixer } from "./pcm"
import type { AudioPacket, FramePacket, LiveOptions, ProblemInfo } from "./contracts"

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  private screenshotHelper: ScreenshotHelper
  public shortcutsHelper: ShortcutsHelper
  public processingHelper: ProcessingHelper
  private tray: Tray | null = null
  public captureHelper: CaptureHelper
  public liveHelper: LiveHelper
  private mixer?: PcmMixer
  private mixTimer?: ReturnType<typeof setInterval>
  private nativeAudio = new SystemAudioCapture()
  private liveOptions?: LiveOptions
  private startEpoch = 0
  private pendingStart?: number

  // View management
  private view: "queue" | "solutions" = "queue"

  private problemInfo: ProblemInfo | null = null

  private hasDebugged: boolean = false

  // Processing events
  public readonly PROCESSING_EVENTS = {
    //global states
    UNAUTHORIZED: "procesing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",

    //states for generating the initial solution
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",

    //states for processing the debugging
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const

  constructor() {
    // Initialize WindowHelper with this
    this.windowHelper = new WindowHelper(this)

    // Initialize ScreenshotHelper
    this.screenshotHelper = new ScreenshotHelper(this.view)

    // Initialize ProcessingHelper
    this.processingHelper = new ProcessingHelper(this)

    this.captureHelper = new CaptureHelper(() => this.getMainWindow())
    this.liveHelper = new LiveHelper(this.processingHelper.getLLMHelper(), event => {
      if (event.status === "error" || event.status === "idle") this.stopCaptureInputs()
      if (event.status === "reconnecting") this.mixer?.clear()
      const window = this.getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send("live-event", event)
    })

    // Initialize ShortcutsHelper
    this.shortcutsHelper = new ShortcutsHelper(this)
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  public async startLive(options: LiveOptions): Promise<{ sessionId: string }> {
    if (this.pendingStart !== undefined || !["idle", "error"].includes(this.liveHelper.state)) throw new Error("A Live session is already running")
    const epoch = ++this.startEpoch
    this.pendingStart = epoch
    try {
    if (!options.microphone && !options.systemAudio && !options.screen) throw new Error("Enable at least one capture input")
    if (!this.processingHelper.getLLMHelper().getConfig().capabilities.live) throw new Error("Live requires a configured Gemini provider")
    const capabilities = await this.captureHelper.capabilities()
    if (epoch !== this.startEpoch) throw new Error("Live start canceled")
    if (options.screen && !capabilities.screen) throw new Error("Screen capture requires a graphical desktop")
    if (options.systemAudio && !capabilities.systemAudio) throw new Error(capabilities.systemAudioReason || "System audio is unavailable")
    if (options.screen || (options.systemAudio && process.platform === "win32")) this.captureHelper.select(options.sourceId || "", options.systemAudio)
    if (options.systemAudio && process.platform === "linux" && !capabilities.systemSources.some(source => source.id === options.systemSourceId)) throw new Error("Select an available system output")
    const sessionId = await this.liveHelper.start()
    if (epoch !== this.startEpoch) throw new Error("Live start canceled")
    this.liveOptions = options
    this.mixer = new PcmMixer([...(options.microphone ? ["microphone" as const] : []), ...(options.systemAudio ? ["system" as const] : [])])
    if (options.systemAudio && process.platform === "linux") this.nativeAudio.start(options.systemSourceId!, data => {
      if (this.liveHelper.state === "active") this.mixer?.push("system", data)
    }, error => this.liveHelper.fail(new Error(error)))
    this.mixTimer = setInterval(() => {
      if (this.liveHelper.state !== "active") { this.mixer?.clear(); return }
      const data = this.mixer?.take(); if (data) this.liveHelper.sendAudio(data)
      this.liveHelper.flushFrame()
    }, 100)
    return { sessionId }
    } finally { if (this.pendingStart === epoch) this.pendingStart = undefined }
  }
  public receiveAudio(packet: AudioPacket): void {
    if (packet.sessionId !== this.liveHelper.sessionId || this.liveHelper.state !== "active") return
    if (packet.source === "microphone" && !this.liveOptions?.microphone) return
    if (packet.source === "system" && (!this.liveOptions?.systemAudio || process.platform !== "win32")) return
    if (!["microphone", "system"].includes(packet.source) || !(packet.data instanceof Uint8Array) || packet.data.length > 32000) return
    this.mixer?.push(packet.source, packet.data)
  }
  public receiveFrame(packet: FramePacket): void {
    if (packet.sessionId !== this.liveHelper.sessionId || !this.liveOptions?.screen) return
    if (typeof packet.data !== "string" || packet.data.length > 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(packet.data)) return
    this.liveHelper.sendFrame(packet.data)
  }
  private stopCaptureInputs(): void {
    clearInterval(this.mixTimer); this.mixTimer = undefined
    this.nativeAudio.stop(); this.mixer?.clear(); this.mixer = undefined; this.liveOptions = undefined
  }
  public stopLive(): void { this.startEpoch++; this.pendingStart = undefined; this.stopCaptureInputs(); this.liveHelper.stop(); this.captureHelper.reset() }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(): void {
    this.windowHelper.showMainWindow()
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )
    this.windowHelper.toggleMainWindow()
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public clearQueues(): void {
    this.stopLive()
    this.processingHelper.cancelOngoingRequests()
    this.screenshotHelper.clearQueues()

    // Clear problem info
    this.problemInfo = null

    // Reset view and synchronize the cleared conversation revision with the renderer.
    this.setView("queue")
    const window = this.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send("llm-config", this.processingHelper.getLLMHelper().getConfig())
  }

  // Screenshot management methods
  public async takeScreenshot(): Promise<string> {
    if (!this.getMainWindow()) throw new Error("No main window available")

    const screenshotPath = await this.screenshotHelper.takeScreenshot(
      () => this.hideMainWindow(),
      () => this.showMainWindow()
    )

    return screenshotPath
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public createTray(): void {
    // Create a simple tray icon
    const image = nativeImage.createEmpty()
    
    // Try to use a system template image for better integration
    let trayImage = image
    try {
      // Create a minimal icon - just use an empty image and set the title
      trayImage = nativeImage.createFromBuffer(Buffer.alloc(0))
    } catch (error) {
      console.log("Using empty tray image")
      trayImage = nativeImage.createEmpty()
    }
    
    this.tray = new Tray(trayImage)
    
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Interview Coder',
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: 'Toggle Window',
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Take Screenshot (Cmd+H)',
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send("screenshot-taken", {
                path: screenshotPath,
                preview
              })
            }
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click: () => {
          app.quit()
        }
      }
    ])
    
    this.tray.setToolTip('Interview Coder - Press Cmd+Shift+Space to show')
    this.tray.setContextMenu(contextMenu)
    
    // Set a title for macOS (will appear in menu bar)
    if (process.platform === 'darwin') {
      this.tray.setTitle('IC')
    }
    
    // Double-click to show window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }
}

// Application initialization
async function initializeApp() {
  const appState = AppState.getInstance()

  // Initialize IPC handlers before window creation
  initializeIpcHandlers(appState)

  app.whenReady().then(() => {
    console.log("App is ready")
    appState.captureHelper.install()
    appState.createWindow()
    appState.createTray()
    // Register global shortcuts using ShortcutsHelper
    appState.shortcutsHelper.registerGlobalShortcuts()
  })

  app.on("before-quit", () => { appState.stopLive(); appState.processingHelper.cancelOngoingRequests() })

  app.on("activate", () => {
    console.log("App activated")
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  app.dock?.hide() // Hide dock icon (optional)
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Start the application
initializeApp().catch(console.error)
