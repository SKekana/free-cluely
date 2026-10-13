import type { ElectronAPI } from "../../electron/contracts"
export type { ElectronAPI }
declare global { interface Window { electronAPI: ElectronAPI } }
