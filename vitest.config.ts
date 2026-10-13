import { defineConfig } from "vitest/config"
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], exclude: ["tests/**/*.smoke.test.ts"], environment: "node", restoreMocks: true, testTimeout: 10000 } })
