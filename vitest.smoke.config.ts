import { defineConfig } from "vitest/config"
export default defineConfig({ test: { include: ["tests/**/*.smoke.test.ts"], environment: "node", fileParallelism: false, testTimeout: 60000, hookTimeout: 30000 } })
